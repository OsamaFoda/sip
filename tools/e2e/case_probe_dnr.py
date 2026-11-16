"""What Firefox reports when one of Sip's declarativeNetRequest rules blocks a request, and
whether onBeforeRedirect carries the hop's size. Records findings; passes when it got them."""
import json
import time
from common import Response, html, blob

PAGE = '<!doctype html><title>probe</title><img src="/a.jpg"><img src="http://www.google-analytics.com/collect.gif">'


def run(ctx):
    ctx.server.route("/probe.html", lambda r: html(PAGE), host="probe.test")
    ctx.server.route("/a.jpg", lambda r: blob(20_000, "image/jpeg"), host="probe.test")
    ctx.server.route("/go", lambda r: Response(b"", status=302, headers={"Location": "http://probe.test/probe.html"}), host="probe.test")
    ctx.set_sip_storage({"opt.images": True})
    time.sleep(1.5)
    # A listener of our own, in Sip's background page, sees what Sip's sees.
    ctx.chrome_js("""
        const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
        window.__sipProbe = [];
        const ext = ExtensionParent.GlobalManager.getExtension('sip@osamafoda.github.io');
        const { WebRequest } = ChromeUtils.importESModule('resource://gre/modules/WebRequest.sys.mjs');
        const filter = { urls: new MatchPatternSet(['<all_urls>']) };
        WebRequest.onErrorOccurred.addListener(d => window.__sipProbe.push({ kind: 'error', url: d.url, error: d.error }), filter, []);
        WebRequest.onBeforeRedirect.addListener(d => window.__sipProbe.push({ kind: 'redirect', url: d.url, responseSize: d.responseSize, requestSize: d.requestSize }), filter, []);
        return true;
    """)
    ctx.open_tab("http://probe.test/go", wait=2)
    seen = ctx.chrome_js("return window.__sipProbe;")
    errors = [e for e in seen if e["kind"] == "error" and "mozilla" not in e["url"]]
    redirects = [e for e in seen if e["kind"] == "redirect"]
    return {"ok": bool(errors), "errors": errors, "redirects": redirects}
