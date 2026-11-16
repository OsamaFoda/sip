"""The autoplay saver: none of the ways a page starts media downloads more than its first 64 KB
on its own, a click on the player's own button plays it, a click elsewhere doesn't, YouTube
watch pages play, and its home page's hover preview doesn't."""
import time
from common import Response, html
from media import audio, slow, video

PAGE = """<!doctype html><meta charset=utf-8><title>videos</title><body>
<script>let stopped = 0; document.addEventListener('sip:media-stopped', () => stopped++, true); window.__stopped = () => stopped;</script>
<div class=player><video id=v1 width=320 autoplay muted src="/a.webm"></video></div>
<div class=player><video id=v2 width=320 preload=auto controls src="/b.webm"></video></div>
<div class=player><video id=v3 width=320 autoplay muted><source src="/c.webm" type="video/webm"></video></div>
<script>
  const d = document.createElement('video'); d.muted = true; d.src = '/d.webm'; d.play().catch(() => {}); window.__d = d;
  const e = document.createElement('video'); e.width = 320; document.body.append(e);
  setTimeout(() => { e.muted = true; e.src = '/e.webm'; e.play().catch(() => {}); }, 800);
</script>
<audio id=a1 autoplay src="/g.webm"></audio>
<div class=player><div class=frame><video id=v6 width=320 preload=none src="/f.webm"></video></div><button id=b6>Play</button></div>
<script>document.getElementById('b6').addEventListener('click', () => document.getElementById('v6').play());</script>
<nav><a id=elsewhere href="#x">elsewhere</a></nav>
"""

WATCH = """<!doctype html><meta charset=utf-8><title>watch</title><video id=w width=320 autoplay muted src="/watch.webm"></video>"""
HOME = """<!doctype html><meta charset=utf-8><title>home</title><video id=h width=320 muted src="/preview.webm"></video>
<script>setTimeout(() => document.getElementById('h').play().catch(() => {}), 600);</script>"""

LIMIT = 64_000


def run(ctx):
    s = ctx.server
    clip, sound = video(), audio()
    s.route("/page.html", lambda r: html(PAGE), host="video.test")
    for name in "abcdef":
        s.route(f"/{name}.webm", lambda r: Response(slow(clip), ctype="video/webm", length=len(clip)), host="video.test")
    s.route("/g.webm", lambda r: Response(slow(sound), ctype="audio/webm", length=len(sound)), host="video.test")
    s.route("/watch", lambda r: html(WATCH), host="www.youtube.com")
    s.route("/", lambda r: html(HOME), host="www.youtube.com")
    for name in ("watch", "preview"):
        s.route(f"/{name}.webm", lambda r: Response(slow(clip), ctype="video/webm", length=len(clip)), host="www.youtube.com")

    sent = (lambda host, path: sum(e["sent"] for e in s.requests(host, path)))
    checks = {}
    ctx.open_tab("http://video.test/page.html", wait=3)
    for name in "abcdeg":
        checks[f"/{name}.webm stays under 64 KB on its own ({sent('video.test', f'/{name}.webm')})"] = sent("video.test", f"/{name}.webm") <= LIMIT
    ctx.click("#elsewhere")
    time.sleep(1.5)
    checks[f"a click elsewhere doesn't play anything ({sent('video.test', '/a.webm')})"] = sent("video.test", "/a.webm") <= LIMIT and sent("video.test", "/f.webm") <= LIMIT
    checks["the page saw Sip stop something"] = ctx.page_js("return page.__stopped();") >= 1
    ctx.click("#b6")
    time.sleep(2.5)
    playing = ctx.page_js("const v = document.getElementById('v6'); return { paused: v.paused, time: v.currentTime };")
    checks[f"the player's own button plays it ({sent('video.test', '/f.webm')}, {playing})"] = sent("video.test", "/f.webm") > LIMIT and not playing["paused"]

    ctx.open_tab("http://www.youtube.com/watch?v=abc", wait=3)
    checks[f"a YouTube watch page plays ({sent('www.youtube.com', '/watch.webm')})"] = sent("www.youtube.com", "/watch.webm") > LIMIT
    ctx.open_tab("http://www.youtube.com/", wait=3)
    checks[f"YouTube's home page preview doesn't ({sent('www.youtube.com', '/preview.webm')})"] = sent("www.youtube.com", "/preview.webm") <= LIMIT
    return {"ok": all(checks.values()), "checks": checks}
