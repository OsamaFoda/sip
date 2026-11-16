"""A site whose rule turns every saver off gets its cross-origin iframes' video and images back
(the allowAllRequests rule and frame.allowed); without the rule both are held."""
import time
from common import Response, blob, html
from media import slow, video

TOP = '<!doctype html><meta charset=utf-8><link rel=icon href="data:,"><iframe src="http://b.test/frame.html" width=400 height=300></iframe>'
FRAME = '<!doctype html><meta charset=utf-8><link rel=icon href="data:,"><video autoplay muted width=320 src="/v.webm"></video><img src="/i.jpg">'
ALL_OFF = {"autoplay": False, "trackers": False, "images": False, "fonts": False}


def run(ctx):
    s = ctx.server
    clip = video()
    s.route("/top.html", lambda r: html(TOP), host="a.test")
    s.route("/frame.html", lambda r: html(FRAME), host="b.test")
    s.route("/v.webm", lambda r: Response(slow(clip), ctype="video/webm", length=len(clip)), host="b.test")
    s.route("/i.jpg", lambda r: blob(30_000, "image/jpeg"), host="b.test")
    sent = lambda path: sum(e["sent"] for e in s.requests("b.test", path))
    checks = {}
    ctx.message({"type": "settings.set", "patch": {"images": True}})
    ctx.message({"type": "site.set", "host": "a.test", "overrides": ALL_OFF})
    time.sleep(1)
    ctx.open_tab("http://a.test/top.html", wait=3)
    checks[f"the allowed site's iframe video plays ({sent('/v.webm')})"] = sent("/v.webm") > 64_000
    checks["and its images load"] = bool(s.requests("b.test", "/i.jpg"))
    ctx.message({"type": "site.set", "host": "a.test", "overrides": None})
    time.sleep(1)
    s.clear()
    ctx.open_tab("http://a.test/top.html", wait=3)
    checks[f"without the rule the video is held ({sent('/v.webm')})"] = sent("/v.webm") <= 64_000
    checks["and the images blocked"] = not s.requests("b.test", "/i.jpg")
    return {"ok": all(checks.values()), "checks": checks}
