"""Save-Data: the header goes out when it's on, not when it's off, and not to a fully allowed site."""
import time
from common import html

ALL_OFF = {"autoplay": False, "trackers": False, "images": False, "fonts": False}


def run(ctx):
    s = ctx.server
    for host in ("sd.test", "free.test"):
        s.route("/p.html", lambda r: html('<!doctype html><link rel=icon href="data:,"><p>x'), host=host)
    header = lambda host: [e["headers"].get("save-data") for e in s.requests(host, "/p.html")]
    checks = {}
    ctx.open_tab("http://sd.test/p.html", wait=1)
    checks["off by default: no header"] = header("sd.test") == [None]
    ctx.message({"type": "settings.set", "patch": {"saveData": True, "sites": {"free.test": ALL_OFF}}})
    time.sleep(1)
    s.clear()
    ctx.open_tab("http://sd.test/p.html", wait=1)
    ctx.open_tab("http://free.test/p.html", wait=1)
    checks[f"on: the header goes out ({header('sd.test')})"] = header("sd.test") == ["on"]
    checks[f"but not to a fully allowed site ({header('free.test')})"] = header("free.test") == [None]
    return {"ok": all(checks.values()), "checks": checks}
