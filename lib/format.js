// Sizes, counts and dates in the interface language. Units are decimal (1 GB = 10^9 bytes),
// the way carriers count.

// Arabic figures use Western digits ('latn'), which read the same as the carrier's SMS and
// next to "GB". Changing this to 'arab' gives Arabic-Indic digits everywhere.
export const ARABIC_DIGITS = 'latn';

// English fallbacks, for code that formats before any messages are loaded (and for tests).
const FALLBACK = { unit_B: 'B', unit_KB: 'KB', unit_MB: 'MB', unit_GB: 'GB', unit_TB: 'TB', fmt_size: '$1 $2' };
const fallbackT = (key, subs = []) => (FALLBACK[key] ?? key).replace(/\$(\d)/g, (_, i) => subs[i - 1] ?? '');

// The Intl locale for a Sip language code.
export function intlLocale(lang) {
  if (lang === 'ar') return `ar-u-nu-${ARABIC_DIGITS}`;
  return 'en-GB';   // "1 Dec", the order the rest of the world reads
}

// A formatter holds the Intl objects for one language. `t` gives the unit names and the
// "$1 $2" pattern that joins number and unit (lib/i18n.js's t, or the English fallback).
export function makeFormatter(lang = 'en', t = fallbackT) {
  const locale = intlLocale(lang);
  const numbers = new Map();
  const number = (n, digits = 0) => {
    if (!numbers.has(digits)) {
      numbers.set(digits, new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    }
    return numbers.get(digits).format(n);
  };
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return { lang, locale, t, number, date };
}

const defaultFormatter = makeFormatter();

// The figure and unit for a size: whole bytes and KB, MB with a decimal under 10 MB,
// GB with two decimals under 100 GB. Each step is judged after rounding, so 999.6 KB reads
// 1.0 MB rather than 1000 KB.
export function sizeParts(n) {
  n = Math.max(0, Math.round(n));
  if (n < 1000) return [n, 0, 'B'];
  if (Math.round(n / 1e3) < 1000) return [Math.round(n / 1e3), 0, 'KB'];
  if (Math.round(n / 1e6) < 1000) {
    const digits = n < 9.95e6 ? 1 : 0;
    return [n / 1e6, digits, 'MB'];
  }
  if (n < 999.95e9) return [n / 1e9, n < 99.995e9 ? 2 : 1, 'GB'];
  return [n / 1e12, 2, 'TB'];
}

export function formatBytes(n, fmt = defaultFormatter) {
  const [value, digits, unit] = sizeParts(n);
  return fmt.t('fmt_size', [fmt.number(value, digits), fmt.t(`unit_${unit}`)]);
}

// "+1.20 GB" / "−0.40 GB", for corrections that can go either way.
export function formatSigned(n, fmt = defaultFormatter) {
  const text = formatBytes(Math.abs(n), fmt);
  return n < 0 ? '−' + text : n > 0 ? '+' + text : text;
}

// Four Latin characters or fewer, for the toolbar badge.
export function compactBytes(n) {
  n = Math.max(0, n);
  if (n < 950e6) return `${Math.round(n / 1e6)}M`;
  const tenths = Math.round(n / 1e8) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)}G`;
  if (Math.round(n / 1e9) < 1000) return `${Math.round(n / 1e9)}G`;
  return `${Math.min(999, Math.round(n / 1e12))}T`;
}

export function formatCount(n, fmt = defaultFormatter) {
  return fmt.number(n, 0);
}

// "1 Dec", from a day key or a Date.
export function formatDate(day, fmt = defaultFormatter) {
  const date = typeof day === 'string' ? new Date(...day.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) : day;
  return fmt.date.format(date);
}

// Plain-text figures inside a sentence keep their own direction in Arabic: first strong
// isolate ... pop directional isolate, the plain-text <bdi>.
export const isolate = text => `⁨${text}⁩`;
