// The `summary` Sip publishes in its storage after every change (Astrelle's New Tab and Settings
// read it, and the popup paints from it first), plus the badge and notifications, all from one
// budgetState(). Every text is already in Sip's interface language.

import { budgetState } from './budget.js';
import { compactBytes, formatBudget, formatBytes, formatCount, formatDate, isolate, makeFormatter } from './format.js';
import { plural as i18nPlural, t as i18nT, uiLocale } from './i18n.js';
import { calendarDay } from './period.js';
import { dateOfDay, dayKey, topSites } from './store.js';

export const SUMMARY_VERSION = 1;

const PACE_SHORT = { ok: 'sum_pace_ok', fast: 'sum_pace_fast', over: 'sum_pace_over' };

function words({ fmt, t = i18nT, plural = i18nPlural, lang }) {
  fmt ??= makeFormatter(lang ?? uiLocale(), t);
  const size = n => isolate(formatBytes(n, fmt));
  const budget = n => isolate(formatBudget(n, fmt));
  const date = d => isolate(formatDate(d, fmt));
  const count = n => isolate(formatCount(n, fmt));
  const days = n => plural('sum_days', n, [count(n)]);
  return { fmt, t, plural, size, budget, date, count, days };
}

export function savedText(saved, w) {
  const parts = [];
  if (saved.req > 0) parts.push(w.plural('sum_saved_req', saved.req, [w.count(saved.req)]));
  if (saved.media > 0) parts.push(w.plural('sum_saved_media', saved.media, [w.count(saved.media)]));
  if (parts.length && saved.est > 0) parts.push(w.t('sum_saved_est', [w.size(saved.est)]));
  return parts.join(w.t('sum_join'));
}

// The summary for a budgetState (see budget.js), or for the raw inputs.
export function summaryFrom(s, settings, now, opts) {
  const w = words(opts);
  const { t, plural, size, date, days } = w;
  const hasBudget = s.budget > 0;
  const { period } = s;
  const top = topSites(s.sites, 1)[0];
  const saved = { req: s.saved.req, media: s.saved.media, est: s.saved.est > 0 ? s.saved.est : null };

  let hero;
  if (!hasBudget) hero = t('sum_hero_used', [size(s.used)]);
  else if (s.left >= 0) hero = t('sum_hero_left', [size(s.left), days(period.daysLeft)]);
  else hero = t('sum_hero_over', [size(-s.left), days(period.daysLeft)]);

  let over = '';
  if (s.overToday > 0) {
    over = s.tomorrow !== null ? t('sum_over_tomorrow', [size(s.overToday), size(s.tomorrow)]) : t('sum_over_today', [size(s.overToday)]);
  }

  return {
    v: SUMMARY_VERSION,
    at: now.getTime(),
    day: dayKey(now),
    lang: w.fmt.lang === 'ar' ? 'ar' : 'en',
    dir: w.fmt.lang === 'ar' ? 'rtl' : 'ltr',
    hasBudget,
    budget: s.budget,
    counted: s.counted,
    used: s.used,
    left: s.left,
    ratio: s.ratio,
    // Rounded, so the summary only changes when something does (an unchanged one isn't rewritten).
    paceRatio: Math.round(Math.min(1, Math.max(0, (now - period.start) / (period.end - period.start))) * 1000) / 1000,
    projected: s.projected,
    projRatio: s.projRatio,
    pace: s.pace,
    level: s.level,
    today: s.today,
    share: s.share,
    overToday: s.overToday,
    tomorrow: s.tomorrow,
    periodStart: dayKey(period.start),
    renew: dayKey(period.end),
    daysLeft: period.daysLeft,
    runOut: s.runOut ? dayKey(s.runOut) : null,
    daysEarly: s.daysEarly,
    topSite: top ? { host: top[0], bytes: top[1] } : null,
    saved,
    youtube: settings.youtube,
    paused: !settings.saver,
    text: {
      hero,
      left: !hasBudget ? '' : s.left >= 0 ? t('sum_left', [size(s.left), w.budget(s.budget)]) : t('sum_over_by', [size(-s.left)]),
      days: plural('sum_days_left', period.daysLeft, [w.count(period.daysLeft)]),
      today: hasBudget ? t('sum_today_share', [size(s.today), size(s.share)]) : t('sum_today', [size(s.today)]),
      over,
      renews: t('sum_renews', [date(period.end)]),
      pace: s.pace === 'fast' && s.runOut ? t('sum_pace', [date(s.runOut), days(s.daysEarly)]) : '',
      paceShort: PACE_SHORT[s.pace] ? t(PACE_SHORT[s.pace]) : '',
      projection: hasBudget && s.projected !== null ? t('sum_projection', [size(s.projected), date(period.end)]) : '',
      saved: savedText(saved, w),
      youtube: settings.youtube ? t('sum_youtube', [String(settings.youtube)]) : t('sum_youtube_none'),
    },
  };
}

export function buildSummary({ settings, days, carrier, now = new Date(), ...opts }) {
  return summaryFrom(budgetState({ settings, days, carrier, now }), settings, now, opts);
}

const BADGE_COLORS = { none: '#3c4043', ok: '#137333', warn: '#b06000', danger: '#c5221f', over: '#c5221f' };

// The toolbar badge: the share of the budget used ("68", "!" once it's all used), or today's
// size without a budget ("312M", switching to G at 950 MB).
export function badgeFor(summary, todayCounted, opts = {}) {
  const w = words(opts);
  const text = summary.hasBudget
    ? (summary.ratio >= 1 ? '!' : String(Math.min(99, Math.floor(summary.ratio * 100))))
    : compactBytes(todayCounted);
  let title = summary.hasBudget ? w.t('badge_title_budget', [summary.text.hero]) : w.t('badge_title_today', [w.size(todayCounted)]);
  if (summary.paused) title += w.t('badge_paused');
  return { text, color: BADGE_COLORS[summary.level] ?? BADGE_COLORS.none, title };
}

const daysBetween = (fromKey, toKey) => calendarDay(dateOfDay(toKey)) - calendarDay(dateOfDay(fromKey));

// The notification due now, if any, and the `warned` record that goes with it. Budget warnings
// (75%, 90%, 100%) fire once per period; the pace warning at most once a week, and only when
// the projection runs out more than 3 days early.
export function notificationFor(summary, settings, warned, now = new Date(), opts = {}) {
  const w = words(opts);
  const { t, size, date, days } = w;
  const fresh = !warned || warned.period !== summary.periodStart;
  const record = { period: summary.periodStart, level: fresh ? 0 : warned.level || 0, paceDay: warned?.paceDay ?? null };
  const level = !summary.hasBudget ? 0 : summary.ratio >= 1 ? 1 : summary.ratio >= 0.9 ? 0.9 : summary.ratio >= 0.75 ? 0.75 : 0;
  const top = summary.topSite;

  if (settings.notify && level > record.level) {
    record.level = level;
    if (level >= 1) {
      return {
        warned: record,
        notification: { id: 'sip-budget', title: t('notif_full_title', [w.budget(summary.budget)]), message: t('notif_full_body', [date(summary.renew)]) },
      };
    }
    const left = size(Math.max(0, summary.left));
    const message = top
      ? t('notif_level_body', [left, days(summary.daysLeft), isolate(top.host), size(top.bytes)])
      : t('notif_level_body_plain', [left, days(summary.daysLeft)]);
    return {
      warned: record,
      notification: { id: 'sip-budget', title: t('notif_level_title', [w.fmt.number(Math.round(level * 100))]), message },
    };
  }
  if (level > record.level) record.level = level;   // notifications off: still remember it was crossed

  const today = dayKey(now);
  const paceDue = !record.paceDay || daysBetween(record.paceDay, today) >= 7;
  if (settings.notifyPace && summary.pace === 'fast' && summary.daysEarly > 3 && summary.runOut && paceDue) {
    record.paceDay = today;
    const message = top
      ? t('notif_pace_body', [date(summary.runOut), days(summary.daysEarly), isolate(top.host)])
      : t('notif_pace_body_plain', [date(summary.runOut), days(summary.daysEarly)]);
    return { warned: record, notification: { id: 'sip-pace', title: t('notif_pace_title'), message } };
  }
  return { warned: record, notification: null };
}
