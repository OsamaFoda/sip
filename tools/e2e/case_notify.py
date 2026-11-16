"""At 76% of the budget a warning is due once: `warned` records it, and a second flush adds none."""
import datetime
import time


def run(ctx):
    today = datetime.date.today()
    ctx.set_sip_storage({"day." + today.isoformat(): {"total": 3_620_000_000, "sites": {"tube.com": 3_620_000_000}}, "opt.budgetGB": 5})
    ctx.reload_sip()   # days are only ever written by the background, which reads them at start
    ctx.message({"type": "flush"})
    first = ctx.sip_storage().get("warned")
    ctx.open_sip_page("options")
    shown = ctx.page_js("return Object.keys(await sip.notifications.getAll());")
    ctx.close_tab()
    ctx.message({"type": "flush"})
    second = ctx.sip_storage().get("warned")
    checks = {
        f"the 75% warning is recorded ({first})": bool(first) and first["level"] == 0.75,
        f"and shown ({shown})": "sip-budget" in shown,
        "a second flush adds nothing": second == first,
    }
    return {"ok": all(checks.values()), "checks": checks}
