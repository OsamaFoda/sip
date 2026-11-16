"""Private windows (counted as one total, no site names), a 20 MB download, and a service
worker's fetches."""
import time
from common import Response, blob, html

PREFS = {"dom.serviceWorkers.testing.enabled": True, "devtools.serviceWorkers.testing.enabled": True}
TIMEOUT = 150
NOICON = '<link rel=icon href="data:,">'
SW = b"self.addEventListener('fetch', e => { if (e.request.url.endsWith('/sw-data')) e.respondWith(fetch(e.request)); });"


def run(ctx):
    s = ctx.server
    checks = {}
    flush = lambda: ctx.message({"type": "flush"})
    today = lambda: next(v for k, v in sorted(ctx.sip_storage().items()) if k.startswith("day."))

    s.route("/sw.html", lambda r: html(NOICON + """<script>
      navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => location.hash || (location.hash = 'ready'));
    </script>"""), host="sw.test")
    s.route("/sw.js", lambda r: Response(SW, ctype="text/javascript"), host="sw.test")
    s.route("/sw-data", lambda r: blob(100_000), host="sw.test")
    s.route("/sw2.html", lambda r: html(NOICON + "<script>setTimeout(() => fetch('/sw-data').then(r => r.arrayBuffer()), 300);</script>"), host="sw.test")
    ctx.open_tab("http://sw.test/sw.html", wait=2)
    ctx.open_tab("http://sw.test/sw2.html", wait=2)
    flush()
    sites = today()["sites"]
    checks[f"a service worker's fetch is credited to its site ({sites.get('sw.test')} vs {s.total('sw.test')})"] = abs(sites.get("sw.test", 0) - s.total("sw.test")) <= s.total("sw.test") * 0.02

    s.route("/file.bin", lambda r: blob(20_000_000, headers={"Content-Disposition": 'attachment; filename="file.bin"'}), host="dl.test")
    s.route("/dl.html", lambda r: html(NOICON + '<a id=get href="/file.bin">get</a>'), host="dl.test")
    ctx.open_tab("http://dl.test/dl.html", wait=1)
    ctx.click("#get")
    time.sleep(6)
    flush()
    got = today()["sites"].get("dl.test", 0)
    checks[f"a 20 MB download is counted ({got} vs {s.total('dl.test')})"] = abs(got - s.total("dl.test")) <= s.total("dl.test") * 0.02

    ctx.chrome_js("""
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      const policy = WebExtensionPolicy.getByID('sip@osamafoda.github.io');
      await ExtensionPermissions.add('sip@osamafoda.github.io', { permissions: ['internal:privateBrowsingAllowed'], origins: [] }, policy.extension);
      return true;""")
    ctx.reload_sip()
    s.route("/p.html", lambda r: html(NOICON + '<img src="/x.jpg">'), host="priv.test")
    s.route("/x.jpg", lambda r: blob(50_000, "image/jpeg"), host="priv.test")
    ctx.open_tab("http://priv.test/p.html", wait=2, private=True)
    flush()
    sites = today()["sites"]
    checks[f"a private window is counted under #private, with no site name ({sites.get('#private')})"] = "priv.test" not in sites and abs(sites.get("#private", 0) - s.total("priv.test")) <= s.total("priv.test") * 0.02
    return {"ok": all(checks.values()), "checks": checks}
