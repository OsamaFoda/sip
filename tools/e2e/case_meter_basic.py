"""The meter and savers on a plain page: today's 0.1 checks, ported. Usage is credited to the
page's site and matches what the server sent (a script without a Content-Length included), an
autoplaying video isn't downloaded, images can be blocked, and a budget shows up."""
import re
import time
from common import Response, html, blob

PAGE = """<!doctype html><title>Sip test</title>
<img src="/img.bin">
<script src="/chunked.js"></script>
<video src="/video.bin" autoplay muted></video>
<p>test page</p>"""


def chunked(r):
    chunks = [b"//" + b"x" * 9_998 for _ in range(10)]
    return Response(iter(chunks), ctype="text/javascript", length=False, headers={"Timing-Allow-Origin": "*"})


def run(ctx):
    s = ctx.server
    s.route("/page.html", lambda r: html(PAGE), host="meter.test")
    s.route("/img.bin", lambda r: blob(200_000, "image/png"), host="meter.test")
    s.route("/video.bin", lambda r: blob(1_000_000, "video/mp4"), host="meter.test")
    s.route("/chunked.js", chunked, host="meter.test")
    checks = {}

    view = ctx.message({"type": "view"})["view"]
    checks["site access is granted"] = view["hostAccess"]

    ctx.open_tab("http://meter.test/page.html", wait=3)
    paths = [e["path"] for e in s.requests("meter.test")]
    checks["the page loaded its image and script"] = "/img.bin" in paths and "/chunked.js" in paths
    checks["the autoplaying video was not downloaded"] = "/video.bin" not in paths

    ctx.message({"type": "flush"})
    stored = ctx.sip_storage()
    today = next(v for k, v in stored.items() if k.startswith("day."))
    server_total = s.total("meter.test")
    counted = today["sites"].get("meter.test", 0)
    checks["usage is credited to the page's site"] = counted > 0 and today["total"] == counted
    checks[f"today's total ({counted}) matches the server ({server_total}), unsized script included"] = abs(counted - server_total) <= max(3000, server_total * 0.03)

    ctx.message({"type": "settings.set", "patch": {"images": True}})
    time.sleep(1)
    s.clear()
    ctx.open_tab("http://meter.test/page.html", wait=2)
    paths = [e["path"] for e in s.requests("meter.test")]
    checks["images are blocked once switched on"] = "/img.bin" not in paths and "/page.html" in paths

    ctx.message({"type": "settings.set", "patch": {"budgetGB": 1}})
    summary = ctx.sip_storage()["summary"]
    left = re.sub("[⁨⁩]", "", summary["text"]["left"])
    checks[f"the budget shows up ({left})"] = summary["hasBudget"] and "left of 1.00 GB" in left
    return {"ok": all(checks.values()), "checks": checks}
