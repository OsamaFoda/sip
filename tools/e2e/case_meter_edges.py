"""The meter against the server's own byte log: an upload, a transfer stopped partway, polling,
a navigation to a 204, a cross-origin iframe and a redirect."""
import time
from common import Response, blob, html

NOICON = '<link rel=icon href="data:,">'


def trickle(total, chunk=4096):
    for i in range(0, total, chunk):
        yield b"\0" * min(chunk, total - i)
        yield None


def run(ctx):
    s = ctx.server
    checks = {}
    flush = lambda: ctx.message({"type": "flush"})
    today = lambda: next(v for k, v in sorted(ctx.sip_storage().items()) if k.startswith("day."))
    site = lambda host: today()["sites"].get(host, 0)
    near = lambda a, b, share, slack=0: abs(a - b) <= b * share + slack

    s.route("/up.html", lambda r: html(NOICON + "<script>fetch('/up', { method: 'POST', body: new Uint8Array(1000000) }).then(r => r.text()).then(t => document.title = 'done');</script>"), host="upload.test")
    s.route("/up", lambda r: html("ok"), host="upload.test")
    ctx.open_tab("http://upload.test/up.html", wait=2)
    flush()
    checks[f"an upload is counted ({site('upload.test')} vs {s.total('upload.test')})"] = near(site("upload.test"), s.total("upload.test"), 0.01)

    s.route("/stop.html", lambda r: html(NOICON + """<script>
      const ac = new AbortController(); let got = 0;
      fetch('/big', { signal: ac.signal }).then(async r => { const reader = r.body.getReader();
        for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; if (got >= 350000) { ac.abort(); break; } } }).catch(() => {});
    </script>"""), host="stop.test")
    s.route("/big", lambda r: Response(trickle(2_000_000), ctype="application/octet-stream", length=2_000_000), host="stop.test")
    ctx.open_tab("http://stop.test/stop.html", wait=4)
    flush()
    sent = s.total("stop.test")
    checks[f"a stopped transfer counts what arrived ({site('stop.test')} vs {sent})"] = sent < 1_000_000 and near(site("stop.test"), sent, 0.02, 16_384)

    s.route("/poll.html", lambda r: html(NOICON + "<script>(async () => { for (let i = 0; i < 10; i++) await (await fetch('/poll')).text(); })();</script>"), host="poll.test")
    s.route("/poll", lambda r: blob(5_000, "application/json"), host="poll.test")
    ctx.open_tab("http://poll.test/poll.html", wait=2)
    flush()
    checks[f"polling the same URL counts every time ({len(s.requests('poll.test', '/poll'))} requests)"] = len(s.requests("poll.test", "/poll")) == 10 and near(site("poll.test"), s.total("poll.test"), 0.01)

    s.route("/old.html", lambda r: html(NOICON + """<script>addEventListener('load', () => {
      location.href = 'http://other.test/nocontent';
      setTimeout(() => fetch('/late').then(r => r.arrayBuffer()), 800); });</script>"""), host="nav.test")
    s.route("/nocontent", lambda r: Response(b"", status=204), host="other.test")
    s.route("/late", lambda r: blob(200_000), host="nav.test")
    ctx.open_tab("http://nav.test/old.html", wait=3)
    flush()
    checks[f"after a 204 navigation, the old page's use is still its own ({site('nav.test')}, 204: {site('other.test')})"] = near(site("nav.test"), s.total("nav.test"), 0.01) and 0 < site("other.test") < 2_000

    s.route("/top.html", lambda r: html(NOICON + '<iframe src="http://frame.test/inner.html"></iframe>'), host="top.test")
    s.route("/inner.html", lambda r: html(NOICON + '<img src="/pic.jpg">'), host="frame.test")
    s.route("/pic.jpg", lambda r: blob(100_000, "image/jpeg"), host="frame.test")
    ctx.open_tab("http://top.test/top.html", wait=2)
    flush()
    both = s.total("top.test") + s.total("frame.test")
    checks[f"a cross-origin iframe is credited to the top site ({site('top.test')} vs {both}, frame: {site('frame.test')})"] = site("frame.test") == 0 and near(site("top.test"), both, 0.01)

    s.route("/go", lambda r: Response(b"", status=302, headers={"Location": "http://redir.test/dest.html"}), host="redir.test")
    s.route("/dest.html", lambda r: html(NOICON + "<p>" + "x" * 20_000), host="redir.test")
    ctx.open_tab("http://redir.test/go", wait=2)
    flush()
    hop = sum(e["sent"] for e in s.requests("redir.test", "/go"))
    final = sum(e["sent"] + e["received"] for e in s.requests("redir.test", "/dest.html"))
    checks[f"a redirect hop is counted by its headers ({site('redir.test')} vs final {final} + hop {hop})"] = site("redir.test") >= final + hop * 0.5 and near(site("redir.test"), s.total("redir.test"), 0.03)
    return {"ok": all(checks.values()), "checks": checks}
