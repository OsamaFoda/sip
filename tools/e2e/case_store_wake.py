"""After the background sleeps, a page wakes it without any rule or script being registered
again, and its video is still held."""
import time
from common import Response, html
from media import slow, video

PREFS = {"extensions.background.idle.timeout": 2000}


def run(ctx):
    s = ctx.server
    clip = video()
    s.route("/v.html", lambda r: html('<link rel=icon href="data:,"><video autoplay muted src="/v.webm"></video>'), host="wake.test")
    s.route("/v.webm", lambda r: Response(slow(clip), ctype="video/webm", length=len(clip)), host="wake.test")
    ctx.set_sip_storage({"opt.debug": True})
    time.sleep(1)
    state = lambda: ctx.chrome_js("""const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      return ExtensionParent.GlobalManager.getExtension('sip@osamafoda.github.io').backgroundState;""")
    # The browser's own background traffic keeps waking it, so it is put to sleep the way an
    # idle background is.
    time.sleep(3)
    slept = ctx.chrome_js("""const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
      const ext = ExtensionParent.GlobalManager.getExtension('sip@osamafoda.github.io');
      window.__sipStarted = 0;
      ext.on('background-script-started', () => { window.__sipStarted++; });
      await ext.terminateBackground({ ignoreDevToolsAttached: true, disableResetIdleForTest: true });
      return ext.backgroundState === 'running' ? 'restarted at once' : ext.backgroundState;""")
    ctx.open_tab("http://wake.test/v.html", wait=3)
    started = ctx.chrome_js("return window.__sipStarted;")
    held = sum(e["sent"] for e in s.requests("wake.test", "/v.webm")) <= 64_000
    ctx.open_sip_page("options")
    debug = ctx.page_js("return (await sip.storage.session.get('debug')).debug || {};")
    checks = {
        f"the background slept and started again ({slept}, {started} start)": started >= 1,
        "the video is held after it wakes": held,
        f"nothing was registered again ({debug})": not debug.get("register") and not debug.get("unregister") and not debug.get("rules"),
    }
    return {"ok": all(checks.values()), "checks": checks}
