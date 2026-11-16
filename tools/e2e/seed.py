"""Realistic months for the interface cases and screenshots: a 50 GB plan renewing on the 1st,
YouTube and a manga site on top."""
import datetime

SITES = [("youtube.com", 0.42), ("asuracomic.net", 0.2), ("reddit.com", 0.12), ("instagram.com", 0.1),
         ("google.com", 0.06), ("web.whatsapp.com", 0.05), ("#extensions", 0.03), ("wikipedia.org", 0.02)]


def month(ctx, *, early=2.0e9, recent=1.0e9, today=0.6e9, budget=50, settings=None, saved=True):
    """Days from the 1st to today: `early` a day until a week ago, `recent` a day since, and
    `today` so far. Sip is restarted so its background reads them."""
    now = datetime.date.today()
    start = now.replace(day=1)
    items = {}
    day = start
    while day <= now:
        total = today if day == now else (recent if (now - day).days <= 7 else early)
        sites = {host: int(total * share) for host, share in SITES}
        entry = {"total": sum(sites.values()), "sites": sites}
        if saved and day == now:
            entry["saved"] = {"req": 1204, "media": 38, "est": 420_000_000}
        items[f"day.{day.isoformat()}"] = entry
        day += datetime.timedelta(days=1)
    stored = ctx.sip_storage()
    old = [k for k in stored if k.startswith("day.")]
    ctx.set_sip_storage({**items, "opt.budgetGB": budget, **(settings or {})}, remove=[k for k in old if k not in items])
    ctx.reload_sip()
    ctx.set_sip_storage({"opt.firstRunDone": True})
    return items
