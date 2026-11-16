"""Site rules: a saver turned on for one site works there only, one turned off for a site lets
that site load, and a trackers rule for one site doesn't open trackers on another."""
import time
from common import blob, html

PAGE = '<!doctype html><meta charset=utf-8><link rel=icon href="data:,"><img src="/p.jpg"><script src="http://www.google-analytics.com/analytics.js"></script>'


def run(ctx):
    s = ctx.server
    for host in ("manga.test", "other.test", "shop.test", "news.test", "blog.test"):
        s.route("/p.html", lambda r: html(PAGE), host=host)
        s.route("/p.jpg", lambda r: blob(20_000, "image/jpeg"), host=host)
    s.route("/analytics.js", lambda r: blob(5_000, "text/javascript"), host="www.google-analytics.com")
    loaded = lambda host: bool(s.requests(host, "/p.jpg"))
    visit = lambda *hosts: [ctx.open_tab(f"http://{h}/p.html", wait=1.2) for h in hosts]
    set_ = lambda patch, sites: (ctx.message({"type": "settings.set", "patch": {**patch, "sites": sites}}), time.sleep(1))
    checks = {}

    set_({"images": False}, {"manga.test": {"images": True}})
    s.clear()
    visit("manga.test", "other.test")
    checks["images off, on for manga.test: blocked there only"] = not loaded("manga.test") and loaded("other.test")

    set_({"images": True}, {"shop.test": {"images": False}})
    s.clear()
    visit("shop.test", "other.test")
    checks["images on, off for shop.test: shop.test loads, others don't"] = loaded("shop.test") and not loaded("other.test")

    set_({"images": False, "trackers": True}, {"news.test": {"trackers": False}})
    s.clear()
    visit("news.test")
    from_news = len(s.requests("www.google-analytics.com"))
    s.clear()
    visit("blog.test")
    from_blog = len(s.requests("www.google-analytics.com"))
    checks[f"a trackers rule for news.test lets its tracker through ({from_news}) but not blog.test's ({from_blog})"] = from_news >= 1 and from_blog == 0
    return {"ok": all(checks.values()), "checks": checks}
