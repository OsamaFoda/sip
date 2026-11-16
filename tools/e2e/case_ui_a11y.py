"""Accessibility on every page, light and dark, English and Arabic: contrast of at least 4.5:1
(3:1 for large text) against the real frosted backgrounds, nothing under 13 px, a name for every
control, a <title>, and nothing wider than the page (the popup at 400 px, settings at 360 px)."""
import os
import time
from common import html
from seed import month

TIMEOUT = 240
AUDIT = open(os.path.join(os.path.dirname(__file__), "a11y.js")).read()


def run(ctx):
    ctx.server.route("/", lambda r: html("<link rel=icon href='data:,'><p>x"), host="asuracomic.net")
    month(ctx)
    ctx.open_tab("http://asuracomic.net/", wait=0.5)
    tid = ctx.chrome_js("""const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      return ExtensionParent.apiManager.global.tabTracker.getId(gBrowser.selectedTab);""")
    problems = {}
    for lang in ("en", "ar"):
        ctx.set_sip_storage({"opt.lang": lang})
        for dark in (0, 1):
            ctx.chrome_js(f"Services.prefs.setIntPref('ui.systemUsesDarkTheme', {dark}); return true;")
            for page, query in (("popup", f"?tabId={tid}"), ("options", ""), ("options", "?first=1")):
                if query == "?first=1":
                    ctx.set_sip_storage({}, remove=["opt.firstRunDone"])
                ctx.open_sip_page(page, query)
                time.sleep(0.8)
                if page == "options":
                    ctx.chrome_js("window.resizeTo(400, 900); return true;")
                    time.sleep(0.4)
                found = ctx.page_js(AUDIT)
                ctx.chrome_js("window.resizeTo(1280, 900); return true;")
                if found:
                    problems[f"{page}{query} {lang} {'dark' if dark else 'light'}"] = found[:6]
                ctx.close_tab()
                ctx.set_sip_storage({"opt.firstRunDone": True})
    return {"ok": not problems, "problems": problems}
