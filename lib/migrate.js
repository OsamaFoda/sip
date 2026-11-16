// Moving stored data forward: Sip 0.1's single-blob storage (v1) to one key per day and per
// setting (v2), and merging the history another copy of Sip handed over (cmd.import).

import { DEFAULTS, normalizeHost, normalizeSetting, optKey, sameValue } from './settings.js';
import { cutoffKey, dayStorageKey, isDayKey, mergeDay } from './store.js';

export const SCHEMA = 2;
const LEGACY_KEYS = ['days', 'settings', 'notified'];

export const isLegacy = stored => stored.schema === undefined && LEGACY_KEYS.some(k => k in stored);

const cleanDay = day => ({
  total: Math.max(0, Math.round(day?.total) || 0),
  sites: Object.fromEntries(Object.entries(day?.sites || {}).filter(([, b]) => b > 0)),
  ...(day?.saved ? { saved: { req: day.saved.req || 0, media: day.saved.media || 0, est: day.saved.est || 0 } } : {}),
});

// v1 -> v2: { set, remove }. Nothing default-valued is written. Run once by the background, as
// one set followed by one remove; with schema 2 already stored, legacy keys are only removed.
export function migrate(stored, now = new Date()) {
  const remove = LEGACY_KEYS.filter(k => k in stored);
  if (stored.schema === SCHEMA) return { set: {}, remove };
  const set = { schema: SCHEMA };
  const cutoff = cutoffKey(now);

  for (const [key, day] of Object.entries(stored.days || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key >= cutoff) set[dayStorageKey(key)] = cleanDay(day);
  }

  const old = stored.settings || {};
  for (const name of ['saver', 'autoplay', 'trackers', 'images', 'fonts', 'youtube', 'budgetGB', 'notify']) {
    if (old[name] === undefined) continue;
    const value = normalizeSetting(name, old[name]);
    if (!sameValue(value, DEFAULTS[name])) set[optKey(name)] = value;
  }
  if (old.resetDay !== undefined) {
    const period = normalizeSetting('period', old.resetDay);
    if (!sameValue(period, DEFAULTS.period)) set[optKey('period')] = period;
  }
  const sites = {};
  for (const raw of Array.isArray(old.allow) ? old.allow : []) {
    const host = normalizeHost(raw);
    if (host) sites[host] = { autoplay: false, trackers: false, images: false, fonts: false };
  }
  if (Object.keys(sites).length) set[optKey('sites')] = normalizeSetting('sites', sites);

  const notified = Object.entries(stored.notified || {});
  if (notified.length) {
    const [period, level] = notified.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0];
    set.warned = { period, level, paceDay: null };
  }
  return { set, remove };
}

// The v2 keys of a payload, whichever shape it was stored in.
function asV2(data, now) {
  if (!data || typeof data !== 'object') return {};
  if (data.schema === SCHEMA || !isLegacy(data)) {
    return Object.fromEntries(Object.entries(data).filter(([k]) => isDayKey(k) || k.startsWith('opt.') || ['carrier', 'warned', 'stats.avg'].includes(k)));
  }
  return migrate(data, now).set;
}

// Merges `cmd.import` ({ id, from, at, data }) into the current storage: day totals and saved
// counts are added (the two copies counted different stretches of time); settings, carrier and
// warnings from the import fill only what current storage lacks. The ack makes it idempotent.
export function applyImport(current, cmd, now = new Date()) {
  const remove = ['cmd.import'];
  if (!cmd?.id || current.ack?.import === cmd.id) return { set: {}, remove };
  const incoming = asV2(cmd.data, now);
  const cutoff = cutoffKey(now);
  const set = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (isDayKey(key)) {
      if (key.slice(4) < cutoff) continue;
      set[key] = mergeDay(cleanDay(current[key]), cleanDay(value));
    } else if (key.startsWith('opt.')) {
      const name = key.slice(4);
      if (current[key] === undefined && name in DEFAULTS) {
        const normalized = normalizeSetting(name, value);
        if (!sameValue(normalized, DEFAULTS[name])) set[key] = normalized;
      }
    } else if (current[key] === undefined && value !== undefined) {
      set[key] = value;
    }
  }
  if (current.schema !== SCHEMA) set.schema = SCHEMA;
  set.ack = { ...(current.ack || {}), import: cmd.id };
  return { set, remove };
}

