"""Astrelle hands over the old add-on's history as cmd.import while Sip runs: the totals merge,
it's acknowledged and removed, the same command again changes nothing, and bytes counted today
but not yet written survive the merge."""
import datetime
import json
import time
from common import blob, html


def run(ctx):
    s = ctx.server
    s.route("/p.html", lambda r: html('<link rel=icon href="data:,"><img src="/i.jpg">'), host="live.test")
    s.route("/i.jpg", lambda r: blob(300_000, "image/jpeg"), host="live.test")
    today = datetime.date.today()
    old_days = {(today - datetime.timedelta(days=i)).isoformat(): {"total": 2_000_000, "sites": {"old.com": 2_000_000}} for i in range(30)}
    cmd = {"id": "11111111-2222-4333-8444-555555555555", "from": "sip@osama.local", "at": 1,
           "data": {"days": old_days, "settings": {"budgetGB": 30, "youtube": 720, "allow": []}, "notified": {}}}

    ctx.open_tab("http://live.test/p.html", wait=1)   # counted in memory; the next flush is 20 s away
    ctx.set_sip_storage({"cmd.import": cmd})
    time.sleep(2)
    ctx.message({"type": "flush"})
    after = ctx.sip_storage()
    day = after["day." + today.isoformat()]
    checks = {
        "acknowledged and removed": after.get("ack", {}).get("import") == cmd["id"] and "cmd.import" not in after,
        f"today keeps both the import and the bytes counted meanwhile ({day['sites']})": day["sites"].get("old.com") == 2_000_000 and day["sites"].get("live.test", 0) > 300_000,
        "older days merged": all(after.get("day." + k, {}).get("sites", {}).get("old.com") == 2_000_000 for k in old_days),
        "settings it had filled in": after.get("opt.budgetGB") == 30 and after.get("opt.youtube") == 720,
    }
    before = {k: v for k, v in after.items() if k.startswith("day.")}
    ctx.set_sip_storage({"cmd.import": cmd})
    time.sleep(2)
    ctx.message({"type": "flush"})
    again = ctx.sip_storage()
    checks["the same command again adds nothing"] = {k: v for k, v in again.items() if k.startswith("day.")} == before and "cmd.import" not in again
    return {"ok": all(checks.values()), "checks": checks}
