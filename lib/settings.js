// Sip's settings. Each one is stored under its own key, `opt.<name>`, and a missing key means
// the default, so nobody ever has to write defaults first. Only the background writes these
// (Astrelle writes a few itself, with the same rules); everyone reads them with loadSettings().

export const DEFAULTS = Object.freeze({
  saver: true,          // master switch; false pauses every saver (not the YouTube limit)
  autoplay: true,       // stop media from playing or preloading on its own
  trackers: true,       // block third-party requests to Sip's tracker list
  images: false,        // block images
  fonts: false,         // block web fonts (part of no saving level)
  saveData: false,      // send Save-Data: on (part of no saving level)
  youtube: 480,         // highest YouTube quality in lines; 0 = no limit. Only ever an explicit choice
  sites: Object.freeze({}),   // host -> { autoplay?, trackers?, images?, fonts? } overrides
  budgetGB: 0,          // data per period in decimal GB; 0 = no budget
  period: Object.freeze({ kind: 'monthly', day: 1 }),
  overhead: 5,          // network overhead estimate, in %
  notify: true,         // 75%, 90% and 100% warnings
  notifyPace: true,     // the weekly "on pace to run out early" warning
  lang: 'auto',         // 'auto' follows the browser; 'en' or 'ar'
  debug: false,         // test-only: count storage and registration calls
  firstRunDone: false,
});

export const SETTING_KEYS = Object.keys(DEFAULTS);
export const YOUTUBE_CHOICES = [240, 360, 480, 720, 1080, 0];
export const SAVERS = ['autoplay', 'trackers', 'images', 'fonts'];
export const MAX_SITES = 500;
export const LANGS = ['auto', 'en', 'ar'];

export const optKey = name => 'opt.' + name;

const BOOLEANS = new Set(['saver', 'autoplay', 'trackers', 'images', 'fonts', 'saveData', 'notify', 'notifyPace', 'debug', 'firstRunDone']);

function toBoolean(value) {
  if (value === 'false' || value === '0') return false;
  return Boolean(value);
}

// Western digits for Arabic-Indic and Persian ones, and a dot for the decimal comma, so "٥٠"
// and "1,5" read as 50 and 1.5.
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  let text = value.trim()
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٫]/g, '.')
    .replace(/[٬\s]/g, '');
  if (!text.includes('.') && /^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  return text === '' ? NaN : Number(text);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// A host as Sip keys it: lowercase, no "www.", no scheme, path or port. '' when it isn't one.
export function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  let text = input.trim().toLowerCase();
  if (text.includes('://')) {
    try { text = new URL(text).hostname; } catch { return ''; }
  }
  text = text.replace(/[/?#].*$/, '');
  if (!text.startsWith('[')) text = text.replace(/:\d*$/, '');
  text = text.replace(/\.$/, '').replace(/^www\./, '');
  if (!text || text.length > 253) return '';
  if (/^\[[0-9a-f:.]+\]$/.test(text)) return text;
  return /^([a-z0-9_]([a-z0-9_-]*[a-z0-9_])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(text) ? text : '';
}

export function isDayKeyString(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function normalizeSites(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [rawHost, rules] of Object.entries(value)) {
    const host = normalizeHost(rawHost);
    if (!host || !rules || typeof rules !== 'object') continue;
    const clean = {};
    for (const saver of SAVERS) {
      if (typeof rules[saver] === 'boolean') clean[saver] = rules[saver];
    }
    if (Object.keys(clean).length) out[host] = { ...out[host], ...clean };
  }
  const hosts = Object.keys(out).slice(0, MAX_SITES).sort();
  return Object.fromEntries(hosts.map(h => [h, out[h]]));
}

function normalizePeriod(value) {
  if (typeof value === 'number' || typeof value === 'string') {
    const day = Math.round(toNumber(value));
    return Number.isFinite(day) ? { kind: 'monthly', day: clamp(day, 1, 31) } : { ...DEFAULTS.period };
  }
  if (!value || typeof value !== 'object') return { ...DEFAULTS.period };
  if (value.kind === 'monthly') {
    const day = Math.round(toNumber(value.day));
    return Number.isFinite(day) ? { kind: 'monthly', day: clamp(day, 1, 31) } : { ...DEFAULTS.period };
  }
  if (value.kind === 'days') {
    const every = Math.round(toNumber(value.every));
    if (!Number.isFinite(every) || !isDayKeyString(value.from)) return { ...DEFAULTS.period };
    return { kind: 'days', every: clamp(every, 1, 60), from: value.from };
  }
  return { ...DEFAULTS.period };
}

// The value a setting is stored and used with. Throws RangeError for a name Sip doesn't have.
export function normalizeSetting(name, value) {
  if (!SETTING_KEYS.includes(name)) throw new RangeError(`Unknown setting: ${name}`);
  if (value === undefined || value === null) return structuredClone(DEFAULTS[name]);
  if (BOOLEANS.has(name)) return toBoolean(value);
  switch (name) {
    case 'youtube': {
      const n = toNumber(value);
      return YOUTUBE_CHOICES.includes(n) ? n : DEFAULTS.youtube;
    }
    case 'sites': return normalizeSites(value);
    case 'budgetGB': {
      const n = toNumber(value);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    }
    case 'period': return normalizePeriod(value);
    case 'overhead': {
      const n = toNumber(value);
      return Number.isFinite(n) ? clamp(Math.round(n * 2) / 2, 0, 20) : DEFAULTS.overhead;
    }
    case 'lang': return LANGS.includes(value) ? value : DEFAULTS.lang;
  }
  return value;
}

// A full, normalized settings object from a storage.local.get() result.
export function loadSettings(stored = {}) {
  const settings = {};
  for (const name of SETTING_KEYS) {
    const value = stored[optKey(name)];
    settings[name] = value === undefined ? structuredClone(DEFAULTS[name]) : normalizeSetting(name, value);
  }
  return settings;
}

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What to write for a patch: changed values go in `set`, values back at their default are
// removed instead, so storage only ever holds what differs from the defaults.
export function diffToStorage(patch, current) {
  const set = {};
  const remove = [];
  const settings = { ...current };
  for (const [name, raw] of Object.entries(patch || {})) {
    const value = normalizeSetting(name, raw);
    settings[name] = value;
    if (sameValue(value, current[name])) continue;
    if (sameValue(value, DEFAULTS[name])) remove.push(optKey(name));
    else set[optKey(name)] = value;
  }
  return { set, remove, settings };
}

// Settings for the changes storage.onChanged reported (a removed key means the default again).
export function applyStorageChanges(settings, changes) {
  const next = { ...settings };
  const changed = [];
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!key.startsWith('opt.')) continue;
    const name = key.slice(4);
    if (!SETTING_KEYS.includes(name)) continue;
    const value = newValue === undefined ? structuredClone(DEFAULTS[name]) : normalizeSetting(name, newValue);
    if (sameValue(value, next[name])) continue;
    next[name] = value;
    changed.push(name);
  }
  return { settings: next, changed };
}
