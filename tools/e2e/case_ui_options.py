"""The settings page against the real background: each field writes exactly its key and shows
the normalized value back, outside changes show within a second but never replace what's being
typed, renewing today and "used so far" do what the budget maths says, and there is no GiB."""
import datetime
import time
from seed import month

TIMEOUT = 180


def run(ctx):
    month(ctx, settings={"opt.youtube": 720})
    ctx.open_sip_page("options")
    time.sleep(0.8)
    value = lambda sel: ctx.page_js(f"return document.querySelector({sel!r}).value;")
    checks = {}

    before = ctx.sip_storage()
    ctx.type("#budget", "42,5")
    time.sleep(0.8)
    after = ctx.sip_storage()
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k) and k.startswith("opt.")}
    checks[f"the budget field writes only its key, normalized ({changed}, {after.get('opt.budgetGB')})"] = changed == {"opt.budgetGB"} and after.get("opt.budgetGB") == 42.5
    ctx.type("#period-day", "40")
    time.sleep(0.8)
    checks[f"day 40 is shown back as 31 ({value('#period-day')})"] = value("#period-day") == "31" and ctx.sip_storage().get("opt.period") == {"kind": "monthly", "day": 31}
    ctx.click('#yt [data-q="1080"]')
    time.sleep(0.6)
    checks["a YouTube choice writes opt.youtube"] = ctx.sip_storage().get("opt.youtube") == 1080

    ctx.set_sip_storage({"opt.budgetGB": 30})
    time.sleep(1)
    checks[f"a change made elsewhere shows within a second ({value('#budget')})"] = value("#budget") == "30"
    ctx.type("#budget", "77", enter=False)
    ctx.set_sip_storage({"opt.budgetGB": 31})
    time.sleep(1)
    checks[f"but not over what's being typed ({value('#budget')})"] = value("#budget") == "77"
    ctx.page_js("document.querySelector('#budget').value = ''; document.querySelector('#budget').blur(); return true;")

    ctx.message({"type": "settings.set", "patch": {"budgetGB": 50, "period": {"kind": "monthly", "day": 1}}})
    summary = ctx.sip_storage()["summary"]
    counted = summary["counted"]
    ctx.open_sip_page("options")
    time.sleep(0.6)
    ctx.type("#used-so-far", "40", enter=False)
    ctx.click("#used-set")
    time.sleep(0.8)
    summary = ctx.sip_storage()["summary"]
    checks[f"used so far makes the period's use 40 GB ({summary['used']})"] = abs(summary["used"] - 40e9) <= 2
    ctx.click("#renew")
    ctx.click("#renew")
    time.sleep(0.8)
    summary = ctx.sip_storage()["summary"]
    checks[f"renewing today starts the period today ({summary['periodStart']})"] = summary["periodStart"] == datetime.date.today().isoformat()
    checks["no GiB anywhere"] = "GiB" not in ctx.page_js("return document.body.textContent;")
    return {"ok": all(checks.values()), "checks": checks}
