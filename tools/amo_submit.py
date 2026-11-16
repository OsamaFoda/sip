"""Submits Sip to addons.mozilla.org (AMO) as a listed add-on, with the texts and screenshots in
store/, using the API keys in ~/.config/astrelle/amo.env (AMO_API_KEY, AMO_API_SECRET; never
printed). Only the standard library is used.

    python3 tools/amo_submit.py            first submission: upload, create the listing, screenshots
    python3 tools/amo_submit.py --version  a new version of the existing add-on

Run tools/release_check.py first. The result goes to store/amo-submission.json.
"""
import base64
import glob
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
API = "https://addons.mozilla.org/api/v5"
ADDON_ID = "sip@osamafoda.github.io"
SLUG = "sip-data-saver"


def keys():
    values = {}
    with open(os.path.expanduser("~/.config/astrelle/amo.env")) as f:
        for line in f:
            name, _, value = line.strip().partition("=")
            values[name] = value.strip().strip('"').strip("'")
    return values["AMO_API_KEY"], values["AMO_API_SECRET"]


def token(key, secret):
    b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=")
    now = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": key, "jti": secrets.token_hex(16), "iat": now, "exp": now + 60}).encode())
    signature = b64(hmac.new(secret.encode(), head + b"." + body, hashlib.sha256).digest())
    return (head + b"." + body + b"." + signature).decode()


def call(method, path, *, data=None, files=None, fields=None):
    url = path if path.startswith("http") else API + path
    headers = {"Authorization": "JWT " + token(*keys())}
    payload = None
    if files is not None:
        boundary = "sip" + secrets.token_hex(12)
        parts = []
        for name, value in (fields or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        for name, path_ in files.items():
            with open(path_, "rb") as f:
                content = f.read()
            kind = "image/png" if path_.endswith(".png") else "application/x-xpinstall"
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{os.path.basename(path_)}"\r\n'
                         f"Content-Type: {kind}\r\n\r\n".encode() + content + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        payload = b"".join(parts)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif data is not None:
        payload = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=payload, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            text = response.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        sys.exit(f"{method} {path}: HTTP {error.code}\n{error.read().decode()[:3000]}")


def listing(lang):
    text = open(os.path.join(ROOT, "store", f"listing.{lang}.md"), encoding="utf-8").read()
    label = {"en": ("Summary", "Description:", "Support:"), "ar": ("الملخص", "الوصف:", "الدعم:")}[lang]
    summary = re.search(rf"\*\*{label[0]}\*\*[^\n]*\n(.+)\n", text).group(1).strip()
    description = text.split(f"**{label[1]}**", 1)[1].split(f"**{label[2]}**", 1)[0].strip()
    lines, out = description.split("\n"), []
    for i, line in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if line.startswith("- "):
            out.append("• " + line[2:])
        elif line and nxt.startswith("- ") or (line and not line.endswith((".", ":", "؟", "?")) and len(line) < 60 and nxt):
            out.append(f"<b>{line}</b>")
        else:
            out.append(line)
    return summary, "\n".join(out)


def wait_for(upload):
    for _ in range(90):
        if upload.get("processed"):
            return upload
        time.sleep(5)
        upload = call("GET", f"/addons/upload/{upload['uuid']}/")
    sys.exit("AMO took too long to check the upload")


def main():
    xpi = os.path.join(ROOT, "dist", "sip.xpi")
    version = json.load(open(os.path.join(ROOT, "manifest.json")))["version"]
    print(f"uploading dist/sip.xpi ({os.path.getsize(xpi) // 1000} KB, version {version})")
    upload = wait_for(call("POST", "/addons/upload/", files={"upload": xpi}, fields={"channel": "listed"}))
    validation = upload.get("validation") or {}
    print(f"validation: {'valid' if upload.get('valid') else 'NOT valid'}, "
          f"{validation.get('errors', 0)} errors, {validation.get('warnings', 0)} warnings, {validation.get('notices', 0)} notices")
    for message in (validation.get("messages") or [])[:30]:
        print(f"  {message.get('type')}: {message.get('message')} ({message.get('file', '')})")
    if not upload.get("valid"):
        sys.exit("Stopped: AMO's validator rejected the upload.")

    if "--version" in sys.argv:
        result = call("POST", f"/addons/addon/{ADDON_ID}/versions/", data={"upload": upload["uuid"], "license": "MPL-2.0"})
    else:
        en = listing("en")
        result = call("POST", "/addons/addon/", data={
            "slug": SLUG,
            "categories": ["privacy-security"],
            # AMO doesn't take Arabic listing text ("ar" isn't one of its languages); the add-on
            # itself speaks Arabic either way.
            "summary": {"en-US": en[0]},
            "description": {"en-US": en[1]},
            "homepage": {"en-US": "https://github.com/OsamaFoda/sip"},
            "support_url": {"en-US": "https://github.com/OsamaFoda/sip/issues"},
            "version": {"upload": upload["uuid"], "license": "MPL-2.0"},
        })
        for shot in sorted(glob.glob(os.path.join(ROOT, "store", "screenshots", "*.png"))):
            call("POST", f"/addons/addon/{ADDON_ID}/previews/", files={"image": shot})
            print("screenshot:", os.path.basename(shot))
    record = {"at": time.strftime("%Y-%m-%d %H:%M"), "version": version, "slug": result.get("slug", SLUG),
              "url": result.get("url"), "status": result.get("status"),
              "version_status": (result.get("current_version") or result.get("version") or result).get("file", {}).get("status")}
    with open(os.path.join(ROOT, "store", "amo-submission.json"), "w") as f:
        json.dump(record, f, indent=2)
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
