"""What Sip saved: 5 trackers and 3 images blocked make 8 requests; with no samples there is no
size estimate; after 30 images seen on an allowed site, blocked images get one."""
import time
from common import blob, html

TRACKERS = ["www.google-analytics.com/a.js", "securepubads.g.doubleclick.net/b.js", "static.hotjar.com/c.js", "static.criteo.net/d.js", "cdn.taboola.com/e.js"]


def run(ctx):
    s = ctx.server
    tags = "".join(f'<script src="http://{u}"></script>' for u in TRACKERS) + "".join(f'<img src="/{i}.jpg">' for i in range(3))
    s.route("/p.html", lambda r: html(f'<!doctype html><meta charset=utf-8><link rel=icon href="data:,">{tags}'), host="saved.test")
    many = "".join(f'<img src="/s{i}.jpg">' for i in range(32))
    s.route("/many.html", lambda r: html(f'<!doctype html><meta charset=utf-8><link rel=icon href="data:,">{many}'), host="samples.test")
    for i in range(32):
        s.route(f"/s{i}.jpg", lambda r: blob(10_000, "image/jpeg"), host="samples.test")
    checks = {}
    ctx.message({"type": "settings.set", "patch": {"images": True}})
    time.sleep(1)
    ctx.open_tab("http://saved.test/p.html", wait=2)
    ctx.message({"type": "flush"})
    stored = ctx.sip_storage()
    day = next(v for k, v in stored.items() if k.startswith("day."))
    checks[f"8 requests blocked ({day.get('saved')})"] = (day.get("saved") or {}).get("req") == 8
    checks["no estimate without samples"] = stored["summary"]["saved"]["est"] is None

    ctx.message({"type": "site.set", "host": "samples.test", "overrides": {"images": False}})
    time.sleep(1)
    ctx.open_tab("http://samples.test/many.html", wait=2)
    ctx.open_tab("http://saved.test/p.html", wait=2)
    ctx.message({"type": "flush"})
    stored = ctx.sip_storage()
    checks[f"after 30 samples, blocked images are estimated ({stored['summary']['saved']}, {stored.get('stats.avg')})"] = (stored["summary"]["saved"]["est"] or 0) > 0
    return {"ok": all(checks.values()), "checks": checks}
