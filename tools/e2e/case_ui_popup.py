"""The popup against the real background: it fits in 400 x 520 in every state and language,
shows the YouTube line always, and its controls write exactly the keys they should (levels
never touch the YouTube choice). Screenshots go to ~/.cache/sip-shots/popup-*.png."""
import os
import time
from common import html
from seed import month

TIMEOUT = 240
SHOTS = os.path.expanduser("~/.cache/sip-shots")


def tab_id(ctx):
    return ctx.chrome_js("""const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      return ExtensionParent.apiManager.global.tabTracker.getId(gBrowser.selectedTab);""")


def popup(ctx, site_url, name):
    ctx.open_tab(site_url, wait=0.5)
    tid = tab_id(ctx)
    ctx.open_sip_page("popup", f"?tabId={tid}")
    time.sleep(1.2)
    state = ctx.page_js("""
      const body = document.body;
      return { height: body.scrollHeight, width: body.scrollWidth, clientWidth: body.clientWidth,
               dir: document.documentElement.dir, yt: document.getElementById('yt-line').textContent,
               hero: document.getElementById('big').textContent, site: !document.getElementById('site').hidden,
               rows: document.querySelectorAll('#site-list li').length, pending: document.documentElement.classList.contains('i18n-pending') };""")
    os.makedirs(SHOTS, exist_ok=True)
    ctx.m.context("content")
    try:
        body = ctx.m.call("WebDriver:FindElement", {"using": "css selector", "value": "body"})["value"]
        data = ctx.m.call("WebDriver:TakeScreenshot", {"id": list(body.values())[0]})["value"]
    finally:
        ctx.m.context("chrome")
    import base64
    with open(os.path.join(SHOTS, f"popup-{name}.png"), "wb") as f:
        f.write(base64.b64decode(data))
    return state


def fits(state):
    return state["height"] <= 520 and state["width"] <= 400 and state["yt"] and not state["pending"]


def run(ctx):
    s = ctx.server
    for host in ("asuracomic.net", "www.youtube.com", "news.test"):
        s.route("/", lambda r: html("<link rel=icon href='data:,'><p>page"), host=host)
    s.route("/watch", lambda r: html("<link rel=icon href='data:,'><p>watch"), host="www.youtube.com")
    checks = {}
    states = {}
    month(ctx, early=1.7e9, recent=1.0e9, today=0.6e9)
    states["ok"] = popup(ctx, "http://asuracomic.net/", "ok")
    states["youtube"] = popup(ctx, "http://www.youtube.com/watch?v=x", "youtube")
    month(ctx, early=1.9e9, recent=2.6e9, today=2.2e9)
    states["fast"] = popup(ctx, "http://news.test/", "fast")
    month(ctx, early=2.6e9, recent=2.5e9, today=1.4e9)
    states["over"] = popup(ctx, "http://news.test/", "over")
    month(ctx, early=1.7e9, recent=1.0e9, today=0.6e9, settings={"opt.lang": "ar"})
    states["ar"] = popup(ctx, "http://asuracomic.net/", "ar")
    states["ar-youtube"] = popup(ctx, "http://www.youtube.com/watch?v=x", "ar-youtube")
    ctx.chrome_js("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 1); return true;")
    states["ar-dark"] = popup(ctx, "http://asuracomic.net/", "ar-dark")
    ctx.message({"type": "settings.set", "patch": {"lang": "en"}})
    states["dark"] = popup(ctx, "http://asuracomic.net/", "dark")
    ctx.chrome_js("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 0); return true;")
    month(ctx, budget=0, settings={"opt.saver": False})
    states["paused-nobudget"] = popup(ctx, "http://news.test/", "paused")
    for name, state in states.items():
        checks[f"{name} fits ({state['height']} tall, {state['width']} wide, {state['rows']} rows)"] = fits(state)
    checks["Arabic is right to left"] = states["ar"]["dir"] == "rtl"

    # The controls against the real background.
    month(ctx, settings={"opt.youtube": 360})
    ctx.open_tab("http://asuracomic.net/", wait=0.5)
    tid = tab_id(ctx)
    ctx.open_sip_page("popup", f"?tabId={tid}")
    time.sleep(1)
    youtube_kept = True
    for level in ("light", "max", "off", "balanced"):
        ctx.click(f'#level [data-level="{level}"]')
        time.sleep(0.6)
        stored = ctx.sip_storage()
        youtube_kept &= stored.get("opt.youtube") == 360
    checks["Light → Max → Off → Balanced never touches the YouTube choice"] = youtube_kept
    stored = ctx.sip_storage()
    checks["back on Balanced: the level keys are at their defaults"] = not any(k in stored for k in ("opt.saver", "opt.autoplay", "opt.images")) and stored.get("opt.trackers") is None
    ctx.click('.chip[data-saver="images"]')
    time.sleep(0.8)
    stored = ctx.sip_storage()
    checks[f"a site chip writes the site's rule ({stored.get('opt.sites')})"] = stored.get("opt.sites") == {"asuracomic.net": {"images": True}}
    reload_shown = ctx.page_js("return !document.getElementById('site-reload').hidden;")
    checks["and offers Reload to apply"] = reload_shown
    return {"ok": all(checks.values()), "checks": checks}
