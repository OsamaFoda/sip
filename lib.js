// Pure helpers shared by the background script, the popup, the options page and the tests.
// Nothing in here touches browser APIs, so it can be tested with plain Node.

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

// How many days of per-day usage we keep. Two months covers any billing period.
export const KEEP_DAYS = 62;

// Budget warnings fire once each time usage crosses one of these fractions.
export const WARN_AT = [0.75, 0.9, 1];

export const DEFAULT_SETTINGS = {
  saver: true,       // master switch for every saving rule below
  autoplay: true,    // stop videos from playing or preloading on their own
  trackers: true,    // block third-party ad and tracker requests
  images: false,     // block images (big saving, but pages look broken)
  fonts: false,      // block web fonts (icon fonts disappear too)
  allow: [],         // sites where nothing is blocked
  budgetGB: 0,       // monthly quota in GB, 0 = no budget
  resetDay: 1,       // day of the month the quota renews
  notify: true,      // show a notification at 75%, 90% and 100%
};

// Ad and tracker networks that cost data on almost every page and never matter to the reader.
// Rules match these domains and their subdomains, and only when loaded by a different site.
export const TRACKERS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google.com', 'adnxs.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'pubmatic.com', 'openx.net',
  'rubiconproject.com', 'casalemedia.com', 'adroll.com', 'amazon-adsystem.com', 'moatads.com',
  'scorecardresearch.com', 'quantserve.com', 'hotjar.com', 'mixpanel.com', 'segment.io',
  'amplitude.com', 'connect.facebook.net', 'ads-twitter.com', 'analytics.tiktok.com',
  'bat.bing.com', 'clarity.ms', 'mc.yandex.ru', 'adform.net',
  'smartadserver.com', 'teads.tv', 'sharethrough.com', 'media.net', 'yieldmo.com',
  'zemanta.com', 'mgid.com', 'revcontent.com', 'propellerads.com', 'popads.net',
];

// Local calendar day as YYYY-MM-DD, so string comparison sorts by date.
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Hostname without a leading "www.", or '' for anything that is not a web page.
export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// True when host is domain itself or one of its subdomains.
export function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

export function isAllowed(host, allow) {
  return allow.some(d => hostMatches(host, d));
}

// Bytes a finished request cost, from its webRequest details.
// Headers are estimated from their text; the body comes from Content-Length.
// `known` is false when the server sent no length (usually streamed HTML or JSON),
// in which case the content script's timing data may fill in the body later.
export function responseBytes(details) {
  let headerBytes = (details.statusLine || '').length + 2;
  let body = null;
  for (const h of details.responseHeaders || []) {
    headerBytes += h.name.length + (h.value || '').length + 4;
    if (h.name.toLowerCase() === 'content-length') {
      const n = parseInt(h.value, 10);
      if (n >= 0) body = n;
    }
  }
  if (details.fromCache) return { bytes: 0, headerBytes: 0, known: true };
  if (details.statusCode === 204 || details.statusCode === 304 || details.method === 'HEAD') body = 0;
  return { bytes: headerBytes + (body ?? 0), headerBytes, known: body !== null };
}

export function addUsage(days, key, site, bytes) {
  if (!bytes) return;
  const day = days[key] ??= { total: 0, sites: {} };
  day.total += bytes;
  day.sites[site] = (day.sites[site] || 0) + bytes;
}

// Drop days older than KEEP_DAYS before `now`.
export function prune(days, now = new Date(), keep = KEEP_DAYS) {
  const cutoff = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - keep));
  for (const key of Object.keys(days)) {
    if (key < cutoff) delete days[key];
  }
}

// Total and per-site usage for days in [fromKey, toKey).
export function sumRange(days, fromKey, toKey) {
  let total = 0;
  const sites = {};
  for (const [key, day] of Object.entries(days)) {
    if (key < fromKey || key >= toKey) continue;
    total += day.total;
    for (const [site, bytes] of Object.entries(day.sites)) {
      sites[site] = (sites[site] || 0) + bytes;
    }
  }
  return { total, sites };
}

function clampedDate(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

// The billing period containing `now`. A reset day past the end of a short month
// (say the 31st in February) falls on that month's last day.
export function billingPeriod(now, resetDay) {
  const day = Math.min(Math.max(Math.round(resetDay) || 1, 1), 31);
  let start = clampedDate(now.getFullYear(), now.getMonth(), day);
  if (now < start) start = clampedDate(now.getFullYear(), now.getMonth() - 1, day);
  const end = clampedDate(start.getFullYear(), start.getMonth() + 1, day);
  const daysLeft = Math.max(1, Math.ceil((end - now) / 86400000));
  return { start, end, daysLeft };
}

// Highest warning fraction that `used` has reached, or 0.
export function warningLevel(used, budget) {
  if (!budget) return 0;
  let level = 0;
  for (const t of WARN_AT) if (used >= budget * t) level = t;
  return level;
}

// Switches unit at 1000 rather than 1024, so the text never reads "1024 MB".
export function formatBytes(n) {
  if (n < 1000) return `${n} B`;
  if (n < 1000 * KB) return `${(n / KB).toFixed(0)} KB`;
  if (n < 1000 * MB) return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
  return `${(n / GB).toFixed(n < 100 * GB ? 2 : 1)} GB`;
}

// Four characters or fewer, for the toolbar badge.
export function compactBytes(n) {
  if (n < GB) return `${Math.round(n / MB)}M`;
  const g = n / GB;
  return g < 10 ? `${g.toFixed(1)}G` : `${Math.round(g)}G`;
}

// Match patterns covering each allowed site and its subdomains. IP addresses have no subdomains.
export function allowPatterns(allow) {
  return allow.map(d => /^[\d.]+$|:/.test(d) ? `*://${d}/*` : `*://*.${d}/*`);
}

// declarativeNetRequest rules for the current settings. Rule ids are fixed per feature.
export function buildRules(settings) {
  if (!settings.saver) return [];
  const rules = [];
  const exempt = settings.allow.length ? { excludedInitiatorDomains: [...settings.allow] } : {};
  const block = (id, condition) => rules.push({ id, priority: 1, action: { type: 'block' }, condition: { ...condition, ...exempt } });

  if (settings.trackers) block(1, { requestDomains: TRACKERS, domainType: 'thirdParty' });
  if (settings.images) block(2, { resourceTypes: ['image'] });
  if (settings.fonts) block(3, { resourceTypes: ['font'] });
  return rules;
}
