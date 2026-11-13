// Runs in every page and frame. Reports transfer sizes from the page's timing data,
// so the meter can size responses that arrived without a Content-Length header.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const pending = [];
  let sendTimer = null;

  function send() {
    sendTimer = null;
    const entries = pending.splice(0);
    try {
      api.runtime.sendMessage({ type: 'sizes', entries }).catch(() => {});
    } catch {
      // The extension was reloaded or removed; this page's script is orphaned.
    }
  }

  function queue(list) {
    for (const e of list.getEntries()) {
      if (e.transferSize > 0) pending.push([e.name, e.transferSize]);
    }
    if (pending.length && !sendTimer) sendTimer = setTimeout(send, 2000);
  }

  try {
    new PerformanceObserver(queue).observe({ type: 'navigation', buffered: true });
    new PerformanceObserver(queue).observe({ type: 'resource', buffered: true });
  } catch {
    // Timing data unavailable; the meter falls back to headers alone.
  }
})();
