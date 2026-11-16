// Messages Sip's pages and content scripts send to the background
// (browser.runtime.sendMessage({ type, ... })). Every reply is { ok: true, ... } or
// { ok: false, error }.
export const MSG = Object.freeze({
  VIEW: 'view',                    // { tabUrl?, tabIncognito? } -> { view }
  SETTINGS_SET: 'settings.set',    // { patch } -> { settings }
  SITE_SET: 'site.set',            // { host, overrides | null } -> { settings }
  LEVEL_SET: 'level.set',          // { level: 'off' | 'light' | 'balanced' | 'max' } -> { settings }
  CARRIER_SET: 'carrier.set',      // { usedSoFar } | { leftNow } | { clear: true } -> { view }
  RENEW_TODAY: 'period.renewToday',// {} -> { settings }
  HISTORY_CLEAR: 'history.clear',  // {} -> {}
  FRAME_ALLOWED: 'frame.allowed',  // {} from a sub-frame -> { autoplay }
  MEDIA_STOPPED: 'media.stopped',  // { n } from autoplay.js, no reply
  SIZES: 'sizes',                  // { entries: [[url, transferSize]] } from content.js (Chrome)
  FLUSH: 'flush',                  // {} -> {}
});
