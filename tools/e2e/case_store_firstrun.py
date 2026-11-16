"""A fresh install outside Astrelle opens the first-run setup; one Astrelle marks as its own
doesn't, and its view says so."""
import time
from common import ROOT, SIP_ID, SIP_ORIGIN, UUID

FIRST_RUN = True
TIMEOUT = 90


def run(ctx):
    tabs = lambda: ctx.chrome_js("return gBrowser.tabs.map(t => t.linkedBrowser.currentURI.spec);")
    time.sleep(10)
    opened = [t for t in tabs() if t.startswith(SIP_ORIGIN + "/options.html?first=1")]
    checks = {f"a fresh install opens the first-run page ({opened})": len(opened) == 1}

    ctx.chrome_js(f"""const {{ AddonManager }} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      await (await AddonManager.getAddonByID('{SIP_ID}')).uninstall(); return true;""")
    ctx.chrome_js("for (const t of [...gBrowser.tabs]) if (t.linkedBrowser.currentURI.spec.startsWith('moz-extension:')) gBrowser.removeTab(t); return true;")
    # Uninstalling forgets the add-on's fixed address; give it back before installing again.
    ctx.chrome_js(f"Services.prefs.setStringPref('extensions.webextensions.uuids', JSON.stringify({{ '{SIP_ID}': '{UUID}' }})); return true;")
    ctx.tabs = ctx.tabs[:1]
    ctx._switch(ctx.tabs[0])
    ctx.install(ROOT)
    ctx.set_sip_storage({"host": "astrelle"})
    time.sleep(10)
    checks["installed by Astrelle: no first-run page"] = not [t for t in tabs() if t.startswith(SIP_ORIGIN)]
    view = ctx.message({"type": "view"})["view"]
    checks["and the view knows it's Astrelle's"] = view["astrelle"] is True and view["firstRun"] is False
    return {"ok": all(checks.values()), "checks": checks}
