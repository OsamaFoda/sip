"""The release gate: everything that must hold before Sip goes to addons.mozilla.org.

    python3 tools/release_check.py          all checks, the end-to-end cases included (~10 min)
    python3 tools/release_check.py --quick  without the end-to-end cases

It runs the unit tests and the string check, packs dist/sip.xpi and checks it: the manifest,
no eval or remote code, logical CSS only, no inline scripts or event attributes (MV3's CSP
blocks them), its size, the licence, the store texts and the README's file table.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
problems = []


def check(ok, what):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        problems.append(what)


def run(args, what):
    done = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    check(done.returncode == 0, what)
    if done.returncode:
        print("      " + (done.stdout + done.stderr).strip().replace("\n", "\n      ")[-2000:])


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def main():
    run(["node", "--test"], "unit tests (node --test)")
    run([sys.executable, "tools/build.py", "--check"], "_locales is up to date and the languages agree")
    run([sys.executable, "tools/build.py"], "packs dist/sip.xpi")

    manifest = json.loads(read("manifest.json"))
    gecko = manifest["browser_specific_settings"]["gecko"]
    check(gecko["id"] == "sip@osamafoda.github.io", "the id is sip@osamafoda.github.io")
    check(manifest["version"] == "1.0.0", "version 1.0.0")
    check(gecko["strict_min_version"] == "140.0", "strict_min_version 140")
    check(manifest.get("default_locale") == "en", "default_locale en")
    check("content_scripts" not in manifest, "no static content_scripts")
    check(gecko.get("data_collection_permissions") == {"required": ["none"]}, "data_collection_permissions: none")

    xpi = os.path.join(ROOT, "dist", "sip.xpi")
    with zipfile.ZipFile(xpi) as z:
        names = z.namelist()
        texts = {n: z.read(n).decode("utf-8") for n in names if n.endswith((".js", ".css", ".html", ".json"))}
    check(os.path.getsize(xpi) < 300_000, f"the xpi is under 300 KB ({os.path.getsize(xpi) // 1000} KB)")
    check(not any(n.startswith(("tests/", "tools/", "store/", "locales/")) for n in names), "nothing but the add-on is packed")
    for name, text in texts.items():
        if name.endswith(".js"):
            check(not re.search(r"\beval\s*\(|\bnew\s+Function\s*\(", text), f"{name}: no eval or new Function")
            check(not re.search(r"""(import|src|importScripts)\s*\(?\s*['"]https?://""", text), f"{name}: no remote code")
        if name.endswith(".css"):
            physical = [m.group(0) for m in re.finditer(
                r"\b(margin|padding|border|inset)-(left|right)\b|(?:^|[\s;{])(left|right)\s*:|\b(float|clear|text-align)\s*:\s*(left|right)\b",
                re.sub(r"/\*.*?\*/", "", text, flags=re.S))]
            check(not physical, f"{name}: logical CSS properties only{' (' + ', '.join(physical[:5]) + ')' if physical else ''}")
        if name.endswith(".html"):
            check(not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", text), f"{name}: no inline <script>")
            check(not re.search(r"\son[a-z]+\s*=", text), f"{name}: no on…= attributes")

    licence = read("LICENSE")
    check(licence.startswith("Mozilla Public License Version 2.0") and "Exhibit B" in licence and len(licence) > 16_000,
          "LICENSE is the complete MPL-2.0")
    for lang, label in (("en", "Summary"), ("ar", "الملخص")):
        text = read(f"store/listing.{lang}.md")
        summary = re.search(rf"\*\*{label}\*\*[^\n]*\n(.+)\n", text)
        check(bool(summary) and len(summary.group(1)) <= 250, f"store/listing.{lang}.md: the summary is 250 characters or fewer")
    reasons = read("store/permissions.md")
    for permission in manifest["permissions"] + manifest["host_permissions"]:
        check(f"`{permission}`" in reasons, f"store/permissions.md explains {permission}")
    check("block content" not in reasons.split("## The install prompt")[1].lower().replace("no separate \"block content on any page\" line", ""),
          "the recorded install prompt has no \"block content\" line")
    for path in re.findall(r"^\| `([^`]+)`", read("README.md"), flags=re.M):
        for part in [p.strip(" `") for p in path.split(",")]:
            check(bool(glob.glob(os.path.join(ROOT, part.rstrip("/")))), f"README's file table: {part} exists")

    if shutil.which("addons-linter"):
        run(["addons-linter", "--self-hosted=false", xpi], "addons-linter")
    else:
        print("skip  addons-linter isn't installed (AMO runs it on upload)")
    if "--quick" not in sys.argv:
        run([sys.executable, "tools/e2e/run.py"], "every end-to-end case")

    print(f"\n{'All checks passed.' if not problems else f'{len(problems)} problem(s).'}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
