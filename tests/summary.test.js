import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeFor, buildSummary, notificationFor } from '../lib/summary.js';
import { plural } from '../lib/i18n.js';
import { loadSettings } from '../lib/settings.js';
import { plain, useLanguage } from './helpers.js';

const settings = patch => ({ ...loadSettings({}), ...patch });
const day = total => ({ total, sites: { 'youtube.com': total * 0.7, 'news.com': total * 0.3 } });
const month = () => {
  const days = {};
  for (let d = 1; d <= 12; d++) days[`2026-11-${String(d).padStart(2, '0')}`] = day(2.5e9);
  days['2026-11-13'] = { ...day(1.2e9), saved: { req: 1204, media: 38, est: 420e6 } };
  return days;
};
const now = new Date(2026, 10, 13, 15);
const text = summary => Object.fromEntries(Object.entries(summary.text).map(([k, v]) => [k, plain(v)]));

test('the summary\'s figures and English texts', () => {
  const fmt = useLanguage('en');
  const s = buildSummary({ settings: settings({ budgetGB: 50, overhead: 5 }), days: month(), carrier: { period: '2026-11-01', other: 2e9 }, now, fmt });
  assert.equal(s.v, 1);
  assert.equal(s.day, '2026-11-13');
  assert.equal(s.used, 34.76e9);
  assert.equal(s.pace, 'fast');
  assert.equal(s.projected, 80.75e9);
  assert.equal(s.projRatio, 80.75 / 50);
  assert.equal(s.renew, '2026-12-01');
  assert.equal(s.runOut, '2026-11-19');
  assert.deepEqual(s.topSite, { host: 'youtube.com', bytes: 31.2e9 * 0.7 });
  assert.deepEqual(text(s), {
    hero: '15.24 GB left · 18 days',
    left: '15.24 GB left of 50 GB',
    days: '18 days left',
    today: 'Today 1.26 GB of 917 MB share',
    over: '343 MB over · tomorrow ≈ 896 MB',
    renews: 'Renews 1 Dec',
    pace: 'At this pace you\'ll run out around 19 Nov (12 days early)',
    paceShort: 'Too fast',
    projection: '≈ 80.75 GB by 1 Dec at this pace',
    saved: 'Blocked 1,204 requests · 38 videos stopped · ≈ 420 MB saved',
    youtube: 'YouTube: up to 480p',
  });
  assert.ok(s.text.hero.includes('⁨'), 'figures are isolated for right-to-left text');
});

test('without a budget, over it, and with nothing saved', () => {
  const fmt = useLanguage('en');
  let s = buildSummary({ settings: settings({ youtube: 0 }), days: { '2026-11-13': day(3.2e9) }, now, fmt });
  assert.equal(plain(s.text.hero), 'Used this period: 3.36 GB');
  assert.equal(s.text.left, '');
  assert.equal(plain(s.text.today), 'Today 3.36 GB');
  assert.equal(s.text.saved, '');
  assert.equal(s.text.paceShort, '');
  assert.equal(plain(s.text.youtube), 'YouTube: no limit');
  assert.equal(s.level, 'none');
  s = buildSummary({ settings: settings({ budgetGB: 10, overhead: 0, saver: false }), days: { '2026-11-05': day(11.2e9) }, now, fmt });
  assert.equal(plain(s.text.hero), 'Over by 1.20 GB · 18 days');
  assert.equal(plain(s.text.left), 'Over by 1.20 GB');
  assert.equal(s.text.paceShort, 'Over budget');
  assert.equal(s.paused, true);
});

test('Arabic texts and plurals', () => {
  const fmt = useLanguage('ar');
  const s = buildSummary({ settings: settings({ budgetGB: 50, overhead: 5 }), days: month(), carrier: { period: '2026-11-01', other: 2e9 }, now, fmt });
  assert.equal(s.lang, 'ar');
  assert.equal(s.dir, 'rtl');
  assert.equal(plain(s.text.hero), 'متبقٍ 15.24 جيجا · 18 يومًا');
  assert.equal(plain(s.text.paceShort), 'أسرع من اللازم');
  assert.equal(plain(s.text.renews).startsWith('تتجدد في 1 '), true);
  const days = n => plain(plural('sum_days', n, [String(n)]));
  assert.deepEqual([0, 1, 2, 3, 11, 100].map(days), ['0 يوم', 'يوم واحد', 'يومان', '3 أيام', '11 يومًا', '100 يوم']);
  useLanguage('en');
  assert.deepEqual([1, 2].map(days), ['1 day', '2 days']);
});

test('the badge: percent used, ! at the end, or today\'s size', () => {
  const fmt = useLanguage('en');
  const s = buildSummary({ settings: settings({ budgetGB: 50, overhead: 5 }), days: month(), now, fmt });
  const badge50 = badgeFor(s, 1.2e9, { fmt });
  assert.equal(badge50.text, '65');
  assert.equal(badge50.color, '#137333');
  assert.equal(plain(badge50.title), `Sip: ${plain(s.text.hero)}`);
  const over = buildSummary({ settings: settings({ budgetGB: 10 }), days: month(), now, fmt });
  assert.equal(badgeFor(over, 0, { fmt }).text, '!');
  const none = buildSummary({ settings: settings({ saver: false }), days: month(), now, fmt });
  const badge = badgeFor(none, 312e6, { fmt });
  assert.equal(badge.text, '312M');
  assert.equal(badge.color, '#3c4043');
  assert.match(plain(badge.title), /^Sip: 312 MB today · saving paused$/);
});

test('budget warnings fire once per level and period; the pace warning once a week', () => {
  const fmt = useLanguage('en');
  const s = settings({ budgetGB: 40, overhead: 5 });
  const summary = buildSummary({ settings: s, days: month(), carrier: { period: '2026-11-01', other: 2e9 }, now, fmt });
  let { warned, notification } = notificationFor(summary, s, null, now, { fmt });
  assert.equal(notification.title, '75% of your data used');
  assert.equal(plain(notification.message), '5.24 GB left for 18 days. The most went to youtube.com (21.84 GB).');
  ({ warned, notification } = notificationFor(summary, s, warned, now, { fmt }));
  assert.equal(notification.id, 'sip-pace');
  assert.equal(warned.paceDay, '2026-11-13');
  ({ notification } = notificationFor(summary, s, warned, now, { fmt }));
  assert.equal(notification, null);
  const nextWeek = new Date(2026, 10, 20, 9);
  ({ notification } = notificationFor({ ...summary }, s, warned, nextWeek, { fmt }));
  assert.equal(notification?.id, 'sip-pace');
  const quiet = settings({ budgetGB: 40, notify: false, notifyPace: false });
  assert.equal(notificationFor(summary, quiet, null, now, { fmt }).notification, null);
  const full = buildSummary({ settings: settings({ budgetGB: 30 }), days: month(), now, fmt });
  assert.match(notificationFor(full, s, null, now, { fmt }).notification.message, /Max saving/);
});
