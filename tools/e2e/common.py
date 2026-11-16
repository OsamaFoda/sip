"""What the end-to-end cases share: a local web server that is also the browser's proxy (so every
hostname, real ad networks included, is answered on 127.0.0.1 and nothing reaches the internet),
and a real Astrelle (or Firefox ESR) with a throwaway profile, driven over Marionette, with Sip
installed from this checkout.

The browser comes from SIP_BROWSER, else AETHER_BIN, else ~/Applications/astrelle/aether, else
firefox-esr. Pages are http:// only: the proxy refuses HTTPS, and that refusal is logged as a leak.
"""
import base64
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SIP_ID = "sip@osamafoda.github.io"
UUID = "5ab1e5ad-0000-4000-8000-000000000010"
SIP_ORIGIN = f"moz-extension://{UUID}"


def find_browser():
    for name in ("SIP_BROWSER", "AETHER_BIN"):
        if os.environ.get(name):
            return os.environ[name]
    path = os.path.expanduser("~/Applications/astrelle/aether")
    if os.path.exists(path):
        return path
    return shutil.which("firefox-esr") or sys.exit("No browser: set SIP_BROWSER")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ----- The server -------------------------------------------------------------------------------

class Response:
    """status, headers and a body: bytes, or an iterable of byte chunks sent as they come
    (a chunk of None pauses for 0.05 s, for slow transfers)."""

    def __init__(self, body=b"", status=200, ctype="text/html; charset=utf-8", headers=None, length=True):
        self.body = body.encode() if isinstance(body, str) else body
        self.status = status
        self.headers = {"Content-Type": ctype, "Cache-Control": "no-store", **(headers or {})}
        self.length = length


def html(text, **kw):
    return Response(text, **kw)


def blob(size, ctype="application/octet-stream", **kw):
    return Response(b"\0" * size, ctype=ctype, **kw)


class Counter:
    def __init__(self, raw):
        self.raw = raw
        self.n = 0

    def write(self, data):
        self.raw.write(data)
        self.n += len(data)
        return len(data)

    def flush(self):
        self.raw.flush()

    @property
    def closed(self):
        return self.raw.closed

    def close(self):
        self.raw.close()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self):
        self.routes = {}
        self.log = []
        self.leaks = []
        self.lock = threading.Lock()
        super().__init__(("127.0.0.1", free_port()), Handler)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def port(self):
        return self.server_address[1]

    def route(self, path, fn, host="*"):
        """fn(request) -> Response. Matched on the exact path (no query), for one host or any."""
        self.routes[(host, path)] = fn

    def requests(self, host=None, path=None):
        with self.lock:
            return [e for e in self.log if (host is None or e["host"] == host) and (path is None or e["path"] == path)]

    def total(self, host=None):
        """Bytes both ways for the logged requests (of one host)."""
        return sum(e["sent"] + e["received"] for e in self.requests(host))

    def clear(self):
        with self.lock:
            self.log.clear()


# Hosts the browser itself may ask for in the background; answered 404, never counted as leaks.
QUIET = ("mozilla.", "firefox.", "mozilla.org", "mozilla.com", "mozilla.net", "detectportal")


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "SipTest"

    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.wfile = Counter(self.wfile)

    def do_CONNECT(self):
        host = self.path.split(":")[0]
        if not host.endswith(QUIET):
            with self.server.lock:
                self.server.leaks.append(("CONNECT", self.path))
        self.send_response(405)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def handle_any(self):
        url = urllib.parse.urlsplit(self.path)
        host = (url.hostname or self.headers.get("Host", "").split(":")[0]).lower()
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        received = len(self.raw_requestline) + len(bytes(self.headers)) + 2 + len(body)
        request = {"host": host, "path": url.path, "query": urllib.parse.parse_qs(url.query), "method": self.command,
                   "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}
        fn = self.server.routes.get((host, url.path)) or self.server.routes.get(("*", url.path))
        if fn is None and not host.endswith(QUIET) and host not in ("127.0.0.1", "localhost"):
            with self.server.lock:
                self.server.leaks.append((self.command, f"http://{host}{url.path}"))
        response = fn(request) if fn else Response(b"not here", status=404, ctype="text/plain")
        start = self.wfile.n
        aborted = False
        try:
            self.send_response(response.status)
            for name, value in response.headers.items():
                self.send_header(name, value)
            if isinstance(response.body, bytes):
                self.send_header("Content-Length", str(len(response.body)))
                self.end_headers()
                self.wfile.write(response.body)
            else:
                if response.length is not True:
                    self.send_header("Content-Length", str(response.length)) if response.length else self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                chunked = not response.length
                for chunk in response.body:
                    if chunk is None:
                        time.sleep(0.05)
                        continue
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk) if chunked else chunk)
                    self.wfile.flush()
                if chunked:
                    self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            aborted = True
            self.close_connection = True
        with self.server.lock:
            self.server.log.append({"host": host, "path": url.path, "method": self.command, "status": response.status,
                                    "sent": self.wfile.n - start, "received": received, "aborted": aborted,
                                    "headers": request["headers"], "t": time.time()})

    do_GET = do_POST = do_HEAD = do_PUT = handle_any


# ----- The browser ------------------------------------------------------------------------------

class Marionette:
    def __init__(self, port):
        for _ in range(80):
            try:
                self.sock = socket.create_connection(("127.0.0.1", port))
                break
            except OSError:
                time.sleep(0.25)
        else:
            raise RuntimeError("the browser did not open Marionette")
        self.buf = b""
        self.msg_id = 0
        self._read()

    def _read(self):
        while b":" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("Marionette closed")
            self.buf += chunk
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
                    raise RuntimeError(f"{name}: {msg[2].get('message', msg[2])}")
                return msg[3]

    def context(self, which):
        self.call("Marionette:SetContext", {"value": which})

    def run(self, script, timeout=30):
        wrapped = ("const done = arguments[arguments.length - 1];"
                   f"(async () => {{ {script} }})().then(v => done(JSON.stringify(v ?? null)), e => done(JSON.stringify({{ error: String(e), stack: e && e.stack }})));")
        value = self.call("WebDriver:ExecuteAsyncScript", {"script": wrapped, "args": [], "scriptTimeout": int(timeout * 1000)})["value"]
        result = json.loads(value)
        if isinstance(result, dict) and set(result) == {"error", "stack"}:
            raise RuntimeError(f"script failed: {result['error']}\n{result['stack']}")
        return result


BASE_PREFS = {
    "extensions.installDistroAddons": False,      # not the browser's own bundled copy of Sip
    "aether.welcome.shown": True,                 # no welcome tab
    "media.autoplay.default": 0,                  # the browser allows autoplay; Sip must stop it
    "media.autoplay.blocking_policy": 0,
    "extensions.webextensions.uuids": json.dumps({SIP_ID: UUID}),
    "network.proxy.type": 1,
    "network.proxy.http": "127.0.0.1",
    "network.proxy.ssl": "127.0.0.1",
    "network.proxy.share_proxy_settings": False,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": True,
    "network.stricttransportsecurity.preloadlist": False,   # youtube.com would turn into https
    "dom.security.https_first": False,
    "dom.security.https_only_mode": False,
    "browser.fixup.fallback-to-https": False,
    "network.dns.disablePrefetch": True,
    "network.prefetch-next": False,
    "network.predictor.enabled": False,
    "browser.safebrowsing.malware.enabled": False,
    "browser.safebrowsing.phishing.enabled": False,
    "browser.safebrowsing.downloads.enabled": False,
    "browser.download.useDownloadDir": True,
    "browser.download.always_ask_before_handling_new_types": False,
    "extensions.webextensions.restrictedDomains": "",
    "network.http.speculative-parallel-limit": 0,
    "browser.places.speculativeConnect.enabled": False,
    "browser.urlbar.speculativeConnect.enabled": False,
    "dom.disable_open_during_load": False,
}


def pref_line(name, value):
    return f"user_pref({json.dumps(name)}, {json.dumps(value)});\n"


class Context:
    """One browser with Sip in it, plus the server. Cases get one of these."""

    def __init__(self, prefs=None, install=True):
        self.server = Server()
        self.profile = tempfile.mkdtemp(prefix="sip-e2e-", dir=os.path.expanduser("~/.cache"))
        self.downloads = os.path.join(self.profile, "downloads")
        os.makedirs(self.downloads)
        port = free_port()
        all_prefs = {**BASE_PREFS, "marionette.port": port, "network.proxy.http_port": self.server.port,
                     "network.proxy.ssl_port": self.server.port, "browser.download.dir": self.downloads,
                     "browser.download.folderList": 2, **(prefs or {})}
        with open(os.path.join(self.profile, "user.js"), "w") as f:
            for name, value in all_prefs.items():
                f.write(pref_line(name, value))
        env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1", XDG_DATA_HOME=os.path.join(self.profile, "xdg"))
        self.proc = subprocess.Popen([find_browser(), "--headless", "--marionette", "--no-remote", "--profile", self.profile],
                                     env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.m = Marionette(port)
            self.m.call("WebDriver:NewSession", {"capabilities": {}})
            self.tabs = [self.m.call("WebDriver:GetWindowHandle")["value"]]
            self.m.context("chrome")
            if install:
                self.install(ROOT)
        except Exception:
            self.stop()
            raise

    # Chrome-privileged script in the browser window; `return` a JSON-able value.
    def chrome_js(self, src, timeout=30):
        self.m.context("chrome")
        return self.m.run(src, timeout)

    def install(self, path):
        self.m.context("chrome")
        self.m.call("Addon:Install", {"path": path, "temporary": True})
        return self.wait_ready()

    def wait_ready(self, timeout=15):
        """Until Sip's background has published its summary."""
        end = time.time() + timeout
        while time.time() < end:
            if "summary" in self.sip_storage():
                return True
            time.sleep(0.25)
        raise RuntimeError("Sip didn't start")

    def url(self, host, path="/"):
        return f"http://{host}{path}"

    def open_tab(self, url, wait=1.5, private=False):
        """Opens url in a new selected tab (or a new private window) and waits for it to load."""
        before = self._handles()
        result = self.chrome_js(f"""
            const url = {json.dumps(url)};
            let win = window;
            if ({json.dumps(private)}) {{
              win = OpenBrowserWindow({{ private: true }});
              await new Promise(r => win.addEventListener('load', r, {{ once: true }}));
              await new Promise(r => setTimeout(r, 500));
            }}
            const tab = win.gBrowser.addTab(url, {{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }});
            win.gBrowser.selectedTab = tab;
            const b = tab.linkedBrowser;
            const end = Date.now() + 20000;
            while (Date.now() < end && (b.currentURI.spec === 'about:blank' || b.webProgress.isLoadingDocument)) await new Promise(r => setTimeout(r, 100));
            return {{ url: b.currentURI.spec }};
        """)
        self._follow(before)
        time.sleep(wait)
        return result

    # Marionette's page scripts run in the tab it was last switched to; these keep it on the
    # tab the case opened last.
    def _handles(self):
        self.m.context("content")
        handles = self.m.call("WebDriver:GetWindowHandles")
        self.m.context("chrome")
        return handles

    def _switch(self, handle):
        self.m.context("content")
        self.m.call("WebDriver:SwitchToWindow", {"handle": handle, "focus": True})
        self.m.context("chrome")

    def _follow(self, before):
        new = [h for h in self._handles() if h not in before]
        if new:
            self.tabs.append(new[-1])
            self._switch(new[-1])

    def close_tab(self):
        self.chrome_js("gBrowser.removeTab(gBrowser.selectedTab); return true;")
        if len(self.tabs) > 1:
            self.tabs.pop()
        self._switch(self.tabs[-1])

    def _db(self):
        return f"""
            const {{ ExtensionStorageIDB }} = ChromeUtils.importESModule('resource://gre/modules/ExtensionStorageIDB.sys.mjs');
            const policy = WebExtensionPolicy.getByID({json.dumps(SIP_ID)});
            const db = await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(policy.extension));
        """

    def sip_storage(self):
        return self.chrome_js(self._db() + "return await db.get(null);")

    def set_sip_storage(self, items, remove=()):
        """Writes Sip's storage from outside, as Astrelle does, and tells Sip about it."""
        return self.chrome_js(self._db() + f"""
            const changes = await db.set({json.dumps(items)}) || {{}};
            const removed = {json.dumps(list(remove))}.length ? await db.remove({json.dumps(list(remove))}) : null;
            Object.assign(changes, removed || {{}});
            ExtensionStorageIDB.notifyListeners({json.dumps(SIP_ID)}, changes);
            return true;
        """)

    def open_sip_page(self, name, query=""):
        """Opens Sip's own page moz-extension://…/<name>.html in a tab; page_js then runs in it."""
        url = f"{SIP_ORIGIN}/{name}.html{query}"
        before = self._handles()
        self.chrome_js(f"""
            const tab = gBrowser.addTab({json.dumps(url)}, {{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }});
            gBrowser.selectedTab = tab;
            const b = tab.linkedBrowser;
            const end = Date.now() + 10000;
            while (Date.now() < end && (b.currentURI.spec !== {json.dumps(url)} || b.webProgress.isLoadingDocument)) await new Promise(r => setTimeout(r, 50));
            return true;
        """)
        self._follow(before)
        time.sleep(0.5)

    def page_js(self, src, timeout=30):
        """Script in the selected tab's page. In Sip's pages, `sip` is the page's browser API."""
        self.m.context("content")
        try:
            return self.m.run("const page = window.wrappedJSObject || window; const sip = page.browser;\n" + src, timeout)
        finally:
            self.m.context("chrome")

    def message(self, msg):
        """A runtime message to Sip's background, sent from one of Sip's pages."""
        self.open_sip_page("options")
        reply = self.page_js(f"""
            const msg = page.JSON.parse({json.dumps(json.dumps(msg))});
            return page.JSON.parse(page.JSON.stringify(await sip.runtime.sendMessage(msg)));
        """)
        self.close_tab()
        return reply

    def click(self, selector):
        """A real (trusted) click on an element of the selected tab's page."""
        self.m.context("content")
        try:
            element = self.m.call("WebDriver:FindElement", {"using": "css selector", "value": selector})["value"]
            self.m.call("WebDriver:ElementClick", {"id": list(element.values())[0]})
        finally:
            self.m.context("chrome")

    def reload_sip(self):
        self.chrome_js(f"const {{ AddonManager }} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');"
                       f"await (await AddonManager.getAddonByID({json.dumps(SIP_ID)})).reload(); return true;")
        time.sleep(1)
        return self.wait_ready()

    def screenshot(self, path):
        self.m.context("content")
        try:
            data = self.m.call("WebDriver:TakeScreenshot", {"full": True})["value"]
        finally:
            self.m.context("chrome")
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(10)
        self.server.shutdown()
        shutil.rmtree(self.profile, ignore_errors=True)
