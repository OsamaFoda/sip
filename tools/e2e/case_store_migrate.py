"""Sip 0.1's storage (one blob of days and settings) moves to one key per day and per setting:
the same totals, nothing legacy left, and the period's total matching."""
import datetime
import time


def run(ctx):
    today = datetime.date.today()
    days = {}
    for i in range(40):
        key = (today - datetime.timedelta(days=i)).isoformat()
        days[key] = {"total": 1_000_000 * (i + 1), "sites": {"a.com": 600_000 * (i + 1), "b.com": 400_000 * (i + 1)}}
    stored = ctx.sip_storage()
    v2 = [k for k in stored if k.startswith(("day.", "opt.")) or k in ("schema", "summary", "warned")]
    ctx.set_sip_storage({"days": days, "notified": {},
                         "settings": {"saver": True, "autoplay": True, "trackers": True, "images": False, "fonts": False,
                                      "youtube": 360, "allow": ["shop.com"], "budgetGB": 50, "resetDay": 7, "notify": True}}, remove=v2)
    ctx.reload_sip()
    time.sleep(1)
    after = ctx.sip_storage()
    checks = {
        "schema 2": after.get("schema") == 2,
        "no legacy keys left": not any(k in after for k in ("days", "settings", "notified")),
        "every day's total is the same": all(after.get("day." + k, {}).get("total") == v["total"] for k, v in days.items()),
        "the settings moved": after.get("opt.youtube") == 360 and after.get("opt.budgetGB") == 50
            and after.get("opt.period") == {"kind": "monthly", "day": 7}
            and after.get("opt.sites") == {"shop.com": {"autoplay": False, "trackers": False, "images": False, "fonts": False}},
    }
    start = today.replace(day=7) if today.day >= 7 else (today.replace(day=1) - datetime.timedelta(days=1)).replace(day=7)
    expected = sum(v["total"] for k, v in days.items() if k >= start.isoformat())
    checks[f"the period total matches ({after['summary']['counted']} vs {expected})"] = after["summary"]["counted"] == expected
    return {"ok": all(checks.values()), "checks": checks}
