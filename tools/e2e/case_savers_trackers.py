"""The tracker list on a feed page carrying the benchmark's trackers: every listed host is
blocked, and what the page needs (its consent dialog) still loads."""
from common import blob, html

TRACKERS = ["www.googletagmanager.com/gtm.js", "www.google-analytics.com/analytics.js", "securepubads.g.doubleclick.net/tag/js/gpt.js",
            "connect.facebook.net/en_US/fbevents.js", "cdn.taboola.com/libtrc/site/loader.js", "c.amazon-adsystem.com/aax2/apstag.js",
            "static.ads-twitter.com/uwt.js", "js.adsrvr.org/up_loader.js", "static.chartbeat.com/js/chartbeat.js",
            "js-agent.newrelic.com/nr-loader-spa.js", "cdn.permutive.com/sdk.js", "pub.doubleverify.com/dvtag/signals.js",
            "imasdk.googleapis.com/js/sdkloader/ima3.js", "static.hotjar.com/c/hotjar.js", "www.clarity.ms/tag/x"]
NEEDED = ["cdn.cookielaw.org/scripttemplates/otSDKStub.js", "feed.test/app.js"]


def run(ctx):
    s = ctx.server
    scripts = "".join(f'<script src="http://{u}"></script>' for u in TRACKERS + NEEDED)
    pixels = '<img src="http://sb.scorecardresearch.com/p?c1=2" width=1 height=1><img src="http://dpm.demdex.net/ibs:dpid=1" width=1 height=1>'
    s.route("/feed.html", lambda r: html(f'<!doctype html><meta charset=utf-8><link rel=icon href="data:,">{scripts}{pixels}<p>feed'), host="feed.test")
    for url in TRACKERS + NEEDED + ["sb.scorecardresearch.com/p", "dpm.demdex.net/ibs:dpid=1"]:
        host, path = url.split("/", 1)
        s.route("/" + path, lambda r: blob(40_000, "text/javascript"), host=host)
    ctx.open_tab("http://feed.test/feed.html", wait=3)
    reached = sorted({e["host"] for e in s.requests() if e["host"] != "feed.test"})
    checks = {
        f"no listed tracker reached the server ({reached})": reached == ["cdn.cookielaw.org"],
        "the page's own script and consent dialog loaded": bool(s.requests("feed.test", "/app.js")) and bool(s.requests("cdn.cookielaw.org")),
    }
    return {"ok": all(checks.values()), "checks": checks}
