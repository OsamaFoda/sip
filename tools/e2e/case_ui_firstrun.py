"""First run: a fresh install opens it, filling it in writes the keys, and opening settings
again doesn't show it again."""
import time
from common import SIP_ORIGIN

FIRST_RUN = True
TIMEOUT = 90


def run(ctx):
    time.sleep(9.5)
    handles_before = ctx._handles()
    ctx._follow([h for h in handles_before if h in ctx.tabs])   # switch to the first-run tab Sip opened
    url = ctx.chrome_js("return gBrowser.selectedBrowser.currentURI.spec;")
    checks = {f"a fresh install opens first run ({url})": url.startswith(SIP_ORIGIN + "/options.html?first=1")}
    time.sleep(0.5)
    checks["it shows the setup, not the settings"] = ctx.page_js("return !document.getElementById('first-run').hidden && document.getElementById('page').hidden;")
    ctx.type("#f-budget", "50", enter=False)
    ctx.type("#f-day", "7", enter=False)
    ctx.type("#f-used", "12", enter=False)
    ctx.click('#f-level [data-level="max"]')
    ctx.click('#f-yt [data-q="720"]')
    ctx.click("#f-done")
    time.sleep(1)
    stored = ctx.sip_storage()
    checks[f"filling it in writes the keys"] = (stored.get("opt.budgetGB") == 50 and stored.get("opt.period") == {"kind": "monthly", "day": 7}
        and stored.get("opt.youtube") == 720 and stored.get("opt.images") is True and stored.get("opt.firstRunDone") is True)
    checks[f"used so far went in ({stored['summary']['used']})"] = abs(stored["summary"]["used"] - 12e9) <= 2
    ctx.open_sip_page("options", "?first=1")
    time.sleep(0.6)
    checks["it doesn't show again"] = ctx.page_js("return document.getElementById('first-run').hidden && !document.getElementById('page').hidden;")
    return {"ok": all(checks.values()), "checks": checks}
