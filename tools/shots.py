"""Renders the store screenshots (1280 x 800) into store/screenshots/: the popup in light, dark
and Arabic, the YouTube quality switcher, and the settings page, on a realistic month (a 50 GB
plan renewing on the 1st, YouTube and a manga site on top). All local, like the e2e cases."""
import base64
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "e2e"))
from common import Context, html  # noqa: E402
from seed import month  # noqa: E402

OUT = os.path.join(HERE, "..", "store", "screenshots")
SHOWCASE = """<!doctype html><html lang="{lang}" dir="{dir}"><meta charset=utf-8><style>
html,body{{margin:0}} .stage{{width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:72px;
font-family:system-ui,"Noto Sans Arabic",sans-serif;color:{fg};
background:radial-gradient(ellipse at 0% 0%,{s1},transparent 60%),radial-gradient(ellipse at 100% 100%,{s3},transparent 60%),{s2}}}
h1{{font-size:46px;line-height:1.15;margin:0 0 16px;max-width:520px;letter-spacing:-.01em}} p{{font-size:21px;line-height:1.5;margin:0;max-width:500px;opacity:.8}}
img{{border-radius:16px;box-shadow:0 30px 70px rgba(10,40,50,.28),0 4px 14px rgba(10,40,50,.18)}}</style>
<div class=stage id=stage><div><h1>{title}</h1><p>{text}</p></div><img src="data:image/png;base64,{img}"></div>"""
LIGHT = dict(fg="#13242b", s1="#cdeee8", s2="#eaf0f6", s3="#e1e0fb")
DARK = dict(fg="#e4eef0", s1="#0b2a2c", s2="#0f1820", s3="#18163a")


def viewport(ctx, width, height):
    """Sizes the window so the page area (beside Astrelle's sidebar and toolbars) is width x height."""
    ctx.chrome_js(f"""
      for (let i = 0; i < 4; i++) {{
        const b = gBrowser.selectedBrowser;
        const dw = {width} - b.clientWidth, dh = {height} - b.clientHeight;
        if (!dw && !dh) break;
        window.resizeTo(window.outerWidth + dw, window.outerHeight + dh);
        await new Promise(r => setTimeout(r, 300));
      }}
      return [gBrowser.selectedBrowser.clientWidth, gBrowser.selectedBrowser.clientHeight];""")


def element_shot(ctx, selector="body"):
    ctx.m.context("content")
    try:
        element = ctx.m.call("WebDriver:FindElement", {"using": "css selector", "value": selector})["value"]
        return ctx.m.call("WebDriver:TakeScreenshot", {"id": list(element.values())[0]})["value"]
    finally:
        ctx.m.context("chrome")


def main():
    os.makedirs(OUT, exist_ok=True)
    ctx = Context()
    pages = {}
    try:
        s = ctx.server
        for host in ("asuracomic.net", "www.youtube.com"):
            s.route("/", lambda r: html("<link rel=icon href='data:,'><p>page"), host=host)
        s.route("/watch", lambda r: html("<link rel=icon href='data:,'><p>watch"), host="www.youtube.com")
        s.route("/show.html", lambda r: html(pages[r["query"]["n"][0]]), host="shots.test")
        viewport(ctx, 1320, 860)
        tab = lambda: ctx.chrome_js("""const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
          return ExtensionParent.apiManager.global.tabTracker.getId(gBrowser.selectedTab);""")

        def popup(url):
            ctx.open_tab(url, wait=0.3)
            ctx.open_sip_page("popup", f"?tabId={tab()}")
            time.sleep(1.2)
            return element_shot(ctx)

        def stage(name, img, title, text, lang="en", dark=False):
            pages[name] = SHOWCASE.format(lang=lang, dir="rtl" if lang == "ar" else "ltr", title=title, text=text, img=img, **(DARK if dark else LIGHT))
            ctx.open_tab(f"http://shots.test/show.html?n={name}", wait=0.8)
            with open(os.path.join(OUT, f"{name}.png"), "wb") as f:
                f.write(base64.b64decode(element_shot(ctx, "#stage")))

        # Allowed in private windows, as Astrelle does, so no hint about them shows.
        ctx.chrome_js("""const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
          const policy = WebExtensionPolicy.getByID('sip@osamafoda.github.io');
          await ExtensionPermissions.add('sip@osamafoda.github.io', { permissions: ['internal:privateBrowsingAllowed'], origins: [] }, policy.extension);
          return true;""")
        month(ctx, early=1.7e9, recent=1.0e9, today=0.6e9)
        stage("1-popup", popup("http://asuracomic.net/"), "See what's left, at a glance",
              "How much of your plan is left, where your pace ends by renewal, and today's fair share. Then the sites that used the most.")
        stage("2-youtube", popup("http://www.youtube.com/watch?v=x"), "YouTube quality is your choice",
              "From 240p to 1080p, or no limit, with what an hour costs. Saving levels never change it.")
        month(ctx, early=1.9e9, recent=2.6e9, today=2.2e9)
        ctx.chrome_js("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 1); return true;")
        stage("3-dark", popup("http://asuracomic.net/"), "A warning before you run out",
              "At this pace you'd run out early, so Sip says when, and offers Max saving to stretch what's left.", dark=True)
        ctx.chrome_js("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 0); return true;")
        month(ctx, early=1.7e9, recent=1.0e9, today=0.6e9, settings={"opt.lang": "ar"})
        stage("4-arabic", popup("http://asuracomic.net/"), "بالعربية أيضًا",
              "سِب يتحدث العربية من اليمين إلى اليسار، مع الأرقام والوحدات كما يكتبها مزوّد الخدمة.", lang="ar")
        ctx.set_sip_storage({"opt.lang": "en"})
        ctx.open_sip_page("options")
        time.sleep(1)
        viewport(ctx, 1280, 800)
        time.sleep(0.5)
        ctx.page_js("document.getElementById('level').scrollIntoView({ block: 'start' }); window.scrollBy(0, -20); return true;")
        time.sleep(0.4)
        ctx.m.context("content")
        try:
            data = ctx.m.call("WebDriver:TakeScreenshot", {"full": False})["value"]
        finally:
            ctx.m.context("chrome")
        path = os.path.join(OUT, "5-settings.png")
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
    finally:
        ctx.stop()
    print(json.dumps(sorted(os.listdir(OUT))))


if __name__ == "__main__":
    main()
