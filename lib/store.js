// Per-day usage as Sip stores it: one storage key per local day, `day.YYYY-MM-DD`, holding
// { total, sites: { host or #bucket: bytes }, saved?: { req, media, est } }.

// Two months covers any billing period.
export const KEEP_DAYS = 62;

// Local calendar day as YYYY-MM-DD, so string comparison sorts by date.
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const dayStorageKey = key => 'day.' + key;
export const isDayKey = key => /^day\.\d{4}-\d{2}-\d{2}$/.test(key);
export const dayOfStorageKey = key => key.slice(4);

// The local midnight a day key stands for.
export function dateOfDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const emptyDay = () => ({ total: 0, sites: {} });

export function addUsage(day, site, bytes) {
  if (!(bytes > 0)) return day;
  day.total += bytes;
  day.sites[site] = (day.sites[site] || 0) + bytes;
  return day;
}

export function addSaved(day, { req = 0, media = 0, est = 0 } = {}) {
  if (!req && !media && !est) return day;
  const saved = day.saved ??= { req: 0, media: 0, est: 0 };
  saved.req += req;
  saved.media += media;
  saved.est += est;
  return day;
}

// Adds one day's figures into another (an import, or requests queued during a rewrite).
export function mergeDay(into, from) {
  into.total += from.total || 0;
  for (const [site, bytes] of Object.entries(from.sites || {})) {
    into.sites[site] = (into.sites[site] || 0) + bytes;
  }
  if (from.saved) addSaved(into, from.saved);
  return into;
}

// The first day key still kept on `now`.
export function cutoffKey(now = new Date(), keep = KEEP_DAYS) {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - keep));
}

// The storage keys (day.*) older than KEEP_DAYS before `now`.
export function pruneKeys(keys, now = new Date()) {
  const cutoff = cutoffKey(now);
  return keys.filter(key => isDayKey(key) && dayOfStorageKey(key) < cutoff);
}

// Total, per-site bytes and saved counts over the days in [fromKey, toKey).
export function sumDays(days, fromKey, toKey) {
  let total = 0;
  const sites = {};
  const saved = { req: 0, media: 0, est: 0 };
  for (const [key, day] of Object.entries(days)) {
    if (key < fromKey || key >= toKey) continue;
    total += day.total || 0;
    for (const [site, bytes] of Object.entries(day.sites || {})) {
      sites[site] = (sites[site] || 0) + bytes;
    }
    if (day.saved) {
      saved.req += day.saved.req || 0;
      saved.media += day.saved.media || 0;
      saved.est += day.saved.est || 0;
    }
  }
  return { total, sites, saved };
}

export const isBucket = site => site.startsWith('#');

// The n sites that used most, largest first ([[site, bytes], ...]). Buckets (#private and
// the like) are left out unless asked for.
export function topSites(sites, n, { buckets = false } = {}) {
  return Object.entries(sites)
    .filter(([site, bytes]) => bytes > 0 && (buckets || !isBucket(site)))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}
