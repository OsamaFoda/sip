// Budget maths, one definition for every surface (popup, notifications, badge, Astrelle's New Tab).
//
// counted: the bytes Sip measured this period.
// used: counted, plus the network overhead estimate, plus other use the person told Sip about
//       ("used so far" or "carrier says left", stored as `carrier`).

import { addDays, billingPeriod, projection, startOfDay } from './period.js';
import { dayKey, sumDays } from './store.js';

// Budget warnings fire once each time `used` crosses one of these fractions.
export const WARN_AT = [0.75, 0.9, 1];

export const GB = 1e9;

// Highest warning fraction that `used` has reached, or 0.
export function warningLevel(used, budget) {
  if (!budget) return 0;
  let level = 0;
  for (const t of WARN_AT) if (used >= budget * t) level = t;
  return level;
}

export function levelName(used, budget) {
  if (!budget) return 'none';
  const ratio = used / budget;
  return ratio >= 1 ? 'over' : ratio >= 0.9 ? 'danger' : ratio >= 0.75 ? 'warn' : 'ok';
}

// The recent full days this period that Sip measured (days before its first record in the
// period weren't measured, so they don't drag the rate down), the last 7 at most, oldest first.
function measuredDays(days, period, now) {
  const startKey = dayKey(period.start);
  const todayKey = dayKey(now);
  const first = Object.keys(days).filter(k => k >= startKey && k < todayKey && days[k].total > 0).sort()[0];
  if (!first) return [];
  const keys = [];
  for (let i = 1; i <= 7; i++) {
    const key = dayKey(addDays(startOfDay(now), -i));
    if (key < first) break;
    keys.unshift(key);
  }
  return keys;
}

// Everything the surfaces show about the budget, from the settings, the stored days
// ({ dayKey: { total, sites, saved } }) and the carrier correction.
export function budgetState({ settings, days, carrier, now = new Date() }) {
  const period = billingPeriod(now, settings.period);
  const startKey = dayKey(period.start);
  const todayKey = dayKey(now);
  const factor = settings.overhead / 100;
  const sum = sumDays(days, startKey, dayKey(period.end));

  const counted = sum.total;
  const overheadBytes = Math.round(counted * factor);
  const otherBytes = carrier && carrier.period === startKey ? Math.round(carrier.other) || 0 : 0;
  const used = counted + overheadBytes + otherBytes;
  const budget = Math.round(settings.budgetGB * GB);
  const left = budget - used;
  const ratio = budget ? used / budget : 0;

  const todayCounted = days[todayKey]?.total || 0;
  const today = Math.round(todayCounted * (1 + factor));
  const share = budget ? Math.max(0, Math.round((left + today) / period.daysLeft)) : 0;
  const overToday = budget ? Math.max(0, today - share) : 0;
  const tomorrow = budget && overToday > 0 && period.daysLeft > 1
    ? Math.round(Math.max(0, left) / (period.daysLeft - 1)) : null;

  const daily = measuredDays(days, period, now).map(k => Math.round((days[k]?.total || 0) * (1 + factor)));
  const proj = projection(daily, left, now, settings.period, today);
  const rate = proj.rate;
  const projected = rate === null ? null : Math.max(used, used - today + Math.round(rate * period.daysLeft));
  const runOut = budget ? proj.runOut : null;

  let pace = null;
  if (budget) pace = used >= budget ? 'over' : rate === null ? 'unknown' : runOut ? 'fast' : 'ok';

  return {
    budget, counted, overheadBytes, otherBytes, used, left, ratio,
    level: levelName(used, budget), warn: warningLevel(used, budget),
    todayCounted, today, share, overToday, tomorrow,
    period, rate, projected, projRatio: budget && projected !== null ? projected / budget : null,
    runOut, daysEarly: runOut ? proj.daysEarly : 0, pace,
    sites: sum.sites, saved: sum.saved,
  };
}
