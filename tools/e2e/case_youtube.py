"""The YouTube limit on a fake YouTube page: what the page is told it can play, a change applied
without a reload, a lower limit applied to the playing video at once, paused saving and site
rules leaving it alone, "no limit" removing it, and youtube-nocookie embeds limited too."""
import time
from common import html

PROBE = """<script>
  const calls = []; window.__calls = calls;
  const player = document.getElementById('movie_player');
  player.setPlaybackQualityRange = (a, b) => calls.push(a + '/' + b);
  window.__probe = h => MediaSource.isTypeSupported(`video/webm; codecs="vp9"; width=${Math.round(h * 16 / 9)}; height=${h}; framerate=30`);
</script>"""
WATCH = "<!doctype html><meta charset=utf-8><title>watch</title><div id=movie_player></div>" + PROBE
EMBED = "<!doctype html><meta charset=utf-8><div id=movie_player></div>" + PROBE + """
<script>parent.postMessage({ p720: __probe(720), p480: __probe(480) }, '*');</script>"""
HOST = """<!doctype html><meta charset=utf-8><title>blog</title>
<script>addEventListener('message', e => { window.__embed = e.data; });</script>
<iframe src="http://www.youtube-nocookie.com/embed/abc" width=480 height=270></iframe>"""


def run(ctx):
    s = ctx.server
    s.route("/watch", lambda r: html(WATCH), host="www.youtube.com")
    s.route("/embed/abc", lambda r: html(EMBED), host="www.youtube-nocookie.com")
    s.route("/post.html", lambda r: html(HOST), host="blog.test")
    probe = lambda h: ctx.page_js(f"return page.__probe({h});")
    checks = {}

    ctx.open_tab("http://www.youtube.com/watch?v=1", wait=1.5)
    checks["at 480, 720 is refused and 480 accepted"] = probe(720) is False and probe(480) is True
    ctx.message({"type": "settings.set", "patch": {"youtube": 720}})
    time.sleep(1)
    checks["raised to 720, the same page now accepts 720"] = probe(720) is True and probe(1080) is False
    before = ctx.page_js("return page.__calls.length;")
    ctx.message({"type": "settings.set", "patch": {"youtube": 360}})
    time.sleep(1)
    calls = ctx.page_js("return Array.from(page.__calls);")
    checks[f"lowered to 360, the playing video changes at once ({calls})"] = calls[before:] == ["medium/medium"]

    ctx.message({"type": "level.set", "level": "off"})
    ctx.message({"type": "site.set", "host": "youtube.com", "overrides": {"autoplay": False, "trackers": False, "images": False, "fonts": False}})
    time.sleep(1)
    ctx.open_tab("http://www.youtube.com/watch?v=2", wait=1.5)
    checks["paused saving and a full site rule leave the limit on"] = probe(480) is False and probe(360) is True
    stored = ctx.sip_storage()
    checks["levels and site rules didn't change the choice"] = stored.get("opt.youtube") == 360

    ctx.message({"type": "settings.set", "patch": {"youtube": 480}})
    time.sleep(1)
    ctx.open_tab("http://blog.test/post.html", wait=2)
    embed = ctx.page_js("return page.__embed ? { p720: page.__embed.p720, p480: page.__embed.p480 } : null;")
    checks[f"a youtube-nocookie embed is limited too ({embed})"] = embed == {"p720": False, "p480": True}

    ctx.message({"type": "settings.set", "patch": {"youtube": 0}})
    time.sleep(1)
    ctx.open_tab("http://www.youtube.com/watch?v=3", wait=1.5)
    checks["no limit removes it"] = probe(1080) is True and ctx.page_js("return document.documentElement.dataset.sipYoutube ?? null;") is None
    return {"ok": all(checks.values()), "checks": checks}
