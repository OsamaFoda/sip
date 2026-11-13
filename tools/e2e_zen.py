"""End-to-end check of Sip in a real Zen (Firefox) browser, with no internet use.

Starts a local web server, launches Zen headless with a throwaway profile over Marionette,
installs Sip as a temporary add-on, loads test pages and reads the results from Sip's popup.

    python3 tools/e2e_zen.py
"""
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROFILE = os.path.expanduser("~/.cache/sip-e2e-profile")
UUID = "5ab1e5ad-0000-4000-8000-000000000001"
PORT = 8765
MARIONETTE_PORT = 2829

PAGE = b"""<!doctype html><title>Sip test</title>
<img src="/img.bin">
<script src="/chunked.js"></script>
<video src="/video.bin" autoplay muted></video>
<p>test page</p>"""

requested = []
sent = []  # body bytes the server sent, one entry per response


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send_body(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
        sent.append(len(body))

    def do_GET(self):
        requested.append(self.path)
        if self.path == "/page.html":
            self.send_body(PAGE, "text/html")
        elif self.path == "/img.bin":
            self.send_body(b"\0" * 200_000, "image/png")
        elif self.path == "/video.bin":
            self.send_body(b"\0" * 1_000_000, "video/mp4")
        elif self.path == "/chunked.js":
            # No Content-Length: the meter has to get this size from the page's timing data.
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Timing-Allow-Origin", "*")
            self.end_headers()
            for _ in range(10):
                chunk = b"//" + b"x" * 9_998
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.write(b"0\r\n\r\n")
            sent.append(100_000)
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()


class Marionette:
    def __init__(self, port):
        for _ in range(60):
            try:
                self.sock = socket.create_connection(("127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("Zen did not open Marionette")
        self.buf = b""
        self.msg_id = 0
        self._read()  # handshake

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.sock.recv(65536)
        length, rest = self.buf.split(b":", 1)
        length = int(length)
        while len(rest) < length:
            rest += self.sock.recv(65536)
        self.buf = rest[length:]
        return json.loads(rest[:length])

    def call(self, name, params=None):
        self.msg_id += 1
        data = json.dumps([0, self.msg_id, name, params or {}]).encode()
        self.sock.sendall(b"%d:%s" % (len(data), data))
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == self.msg_id:
                if msg[2]:
                    raise RuntimeError(f"{name}: {msg[2]}")
                return msg[3]

    def js(self, script):
        return self.call("WebDriver:ExecuteScript", {"script": script, "args": []})["value"]

    def go(self, url, wait=3):
        self.call("WebDriver:Navigate", {"url": url})
        time.sleep(wait)


def open_extension_page(m, page, wait=1.5):
    # Marionette refuses to navigate content to moz-extension:// URLs, so load it from browser chrome.
    m.call("Marionette:SetContext", {"value": "chrome"})
    m.js(f"""
        gBrowser.selectedBrowser.fixupAndLoadURIString("moz-extension://{UUID}/{page}",
            {{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }});
        return true;
    """)
    m.call("Marionette:SetContext", {"value": "content"})
    time.sleep(wait)


def popup_state(m):
    open_extension_page(m, "popup.html")
    return m.js("""
        const t = id => document.getElementById(id).textContent;
        return {
          grantHidden: document.getElementById('grant').hidden,
          today: t('today'),
          period: t('period-used'),
          sites: [...document.querySelectorAll('#sites li')].map(li => li.textContent),
          budgetShown: !document.getElementById('budget-box').hidden,
          left: t('period-left'), pace: t('pace'),
        };
    """)


def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    os.makedirs(PROFILE)
    with open(os.path.join(PROFILE, "user.js"), "w") as f:
        f.write(f'user_pref("marionette.port", {MARIONETTE_PORT});\n')
        f.write('user_pref("extensions.webextensions.uuids", %s);\n' % json.dumps(json.dumps({"sip@osama.local": UUID})))
        f.write('user_pref("media.autoplay.default", 0);\n')  # the browser allows autoplay; Sip must stop it
        f.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    zen = subprocess.Popen(
        ["flatpak", "run", "--env=MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1", f"--filesystem={ROOT}:ro", f"--filesystem={PROFILE}", "app.zen_browser.zen",
         "--headless", "--marionette", "--new-instance", "--profile", PROFILE],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    failures = []

    def check(ok, what):
        print(("PASS " if ok else "FAIL ") + what)
        if not ok:
            failures.append(what)

    try:
        m = Marionette(MARIONETTE_PORT)
        m.call("WebDriver:NewSession", {"capabilities": {}})
        m.call("Addon:Install", {"path": ROOT, "temporary": True})
        time.sleep(1)

        m.go(f"http://127.0.0.1:{PORT}/page.html", wait=5)
        state = popup_state(m)
        print("  popup:", state)
        print("  requested:", requested)
        check(state["grantHidden"], "site access is granted")
        check("/img.bin" in requested and "/chunked.js" in requested, "page loaded its image and script")
        check("/video.bin" not in requested, "autoplaying video was not downloaded")
        check(state["sites"] and state["sites"][0].startswith("127.0.0.1"), "usage is credited to the page's site")
        server_kb = sum(sent) / 1024
        shown_kb = float(state["today"].split()[0]) if state["today"].endswith("KB") else 0
        check(abs(shown_kb - server_kb) <= max(3, server_kb * 0.03),
              f"today's total ({state['today']}) matches what the server sent ({server_kb:.0f} KB), unsized script included")

        m.js("document.querySelector('[data-key=images]').click(); return true;")
        time.sleep(1)
        requested.clear()
        m.go(f"http://127.0.0.1:{PORT}/page.html", wait=4)
        check("/img.bin" not in requested and "/page.html" in requested, "images are blocked once switched on")

        open_extension_page(m, "options.html")
        m.js("const b = document.getElementById('budgetGB'); b.value = '1'; b.dispatchEvent(new Event('change')); return true;")
        time.sleep(1)
        state = popup_state(m)
        print("  popup:", state)
        check(state["budgetShown"] and "left of 1 GB" in state["left"], "budget appears in the popup")
    finally:
        zen.terminate()
        try:
            zen.wait(10)
        except subprocess.TimeoutExpired:
            zen.kill()
        subprocess.run(["pkill", "-f", "--", PROFILE], check=False)
        server.shutdown()
        shutil.rmtree(PROFILE, ignore_errors=True)

    print("\nall checks passed" if not failures else f"\n{len(failures)} check(s) failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
