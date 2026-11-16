"""Three minutes of steady traffic on one site make at most 12 storage writes."""
import time
from common import blob, html

TIMEOUT = 260


def run(ctx):
    s = ctx.server
    s.route("/p.html", lambda r: html('<link rel=icon href="data:,"><script>setInterval(() => fetch("/tick").then(r => r.text()), 1000);</script>'), host="busy.test")
    s.route("/tick", lambda r: blob(2_000, "text/plain"), host="busy.test")
    ctx.set_sip_storage({"opt.debug": True})
    time.sleep(1)
    ctx.open_sip_page("options")
    start = ctx.page_js("return ((await sip.storage.session.get('debug')).debug || {}).set || 0;")
    ctx.close_tab()
    ctx.open_tab("http://busy.test/p.html", wait=180)
    ctx.open_sip_page("options")
    end = ctx.page_js("return ((await sip.storage.session.get('debug')).debug || {}).set || 0;")
    ticks = len(s.requests("busy.test", "/tick"))
    return {"ok": ticks > 150 and end - start <= 12, "writes": end - start, "requests": ticks}
