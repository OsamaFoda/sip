// Billing periods: monthly on a given day, or every N days from a start date.

import { DEFAULTS } from './settings.js';
import { dateOfDay } from './store.js';

// Counted in calendar days, so the 23- or 25-hour day of a clock change doesn't make it one off.
export const calendarDay = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
export const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function clampedDate(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

// The period containing `now`: { start, end, daysLeft, days }, with `end` the day it renews.
// A monthly day past the end of a short month (say the 31st in February) falls on its last day.
// `period` is an opt.period object; a bare number is a monthly day (Sip 0.1's resetDay).
export function billingPeriod(now, period = DEFAULTS.period) {
  if (typeof period === 'number') period = { kind: 'monthly', day: period };
  let start, end;
  if (period?.kind === 'days') {
    const from = dateOfDay(period.from);
    const every = Math.max(1, Math.round(period.every) || 1);
    const k = Math.floor((calendarDay(now) - calendarDay(from)) / every);
    start = addDays(from, k * every);
    end = addDays(start, every);
  } else {
    const day = Math.min(Math.max(Math.round(period?.day) || 1, 1), 31);
    start = clampedDate(now.getFullYear(), now.getMonth(), day);
    if (now < start) start = clampedDate(now.getFullYear(), now.getMonth() - 1, day);
    end = clampedDate(start.getFullYear(), start.getMonth() + 1, day);
  }
  const daysLeft = Math.max(1, calendarDay(end) - calendarDay(now));
  return { start, end, daysLeft, days: calendarDay(end) - calendarDay(start) };
}

// How much of the period has gone by, from 0 to 1.
export function paceRatio(now, period) {
  const { start, end } = billingPeriod(now, period);
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

// The day the data runs out if every day left, today included, uses `rate`: the mean of the
// recent full days (`dailyTotals`, overhead included). null when it lasts to the renewal.
// `today` is what today has used so far; it is part of `left`'s complement, so the data left
// this morning is left + today. This is the same model as the bar's projection, so the pace
// pill says "Too fast" exactly when the projection passes the budget.
export function projection(dailyTotals, left, now, period, today = 0) {
  const none = { runOut: null, daysEarly: 0, rate: null };
  if (dailyTotals.length < 2) return none;
  const rate = dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length;
  if (!(rate > 0)) return none;
  const { end, daysLeft } = billingPeriod(now, period);
  const lasts = Math.max(0, left + today) / rate;
  if (lasts >= daysLeft) return { runOut: null, daysEarly: 0, rate };
  const runOut = addDays(startOfDay(now), Math.max(0, Math.ceil(lasts) - 1));
  return { runOut, daysEarly: calendarDay(end) - calendarDay(runOut), rate };
}

export { addDays };
