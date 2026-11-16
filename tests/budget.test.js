import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetState, warningLevel } from '../lib/budget.js';
import { loadSettings } from '../lib/settings.js';
import { dayKey } from '../lib/store.js';

const settings = patch => ({ ...loadSettings({}), ...patch });
const daysFrom = map => Object.fromEntries(Object.entries(map).map(([k, total]) => [k, { total, sites: { 'a.com': total } }]));
const nov = (d, total) => [`2026-11-${String(d).padStart(2, '0')}`, total];

test('the worked example: overhead, other use, today\'s share and the projection, to the byte', () => {
  const days = daysFrom(Object.fromEntries([...Array.from({ length: 12 }, (_, i) => nov(i + 1, 2.5e9)), nov(13, 1.2e9)]));
  const s = budgetState({
    settings: settings({ budgetGB: 50, overhead: 5 }),
    days, carrier: { period: '2026-11-01', other: 2e9 }, now: new Date(2026, 10, 13, 15),
  });
  assert.equal(s.counted, 31.2e9);
  assert.equal(s.overheadBytes, 1.56e9);
  assert.equal(s.otherBytes, 2e9);
  assert.equal(s.used, 34.76e9);
  assert.equal(s.left, 15.24e9);
  assert.equal(s.period.daysLeft, 18);
  assert.equal(s.today, 1.26e9);
  assert.equal(s.share, 916666667);
  assert.equal(s.overToday, 1.26e9 - 916666667);
  assert.equal(s.tomorrow, 896470588);
  assert.equal(s.rate, 2.625e9);
  assert.equal(s.projected, 80.75e9);
  assert.equal(dayKey(s.runOut), '2026-11-19');
  assert.equal(s.daysEarly, 12);
  assert.equal(s.pace, 'fast');
  assert.equal(s.level, 'ok');
});

test('a heavy first week with a calm recent pace is on track', () => {
  const days = daysFrom(Object.fromEntries([
    ...Array.from({ length: 5 }, (_, i) => nov(i + 1, 4.768e9)), ...Array.from({ length: 7 }, (_, i) => nov(i + 6, 0.98e9)), nov(13, 0.5e9)]));
  const s = budgetState({ settings: settings({ budgetGB: 50, overhead: 0 }), days, now: new Date(2026, 10, 13, 15) });
  assert.equal(s.used, 31.2e9);
  assert.equal(s.projected, 48.34e9);
  assert.equal(s.runOut, null);
  assert.equal(s.pace, 'ok');
  assert.ok(s.projRatio < 1);
});

test('carrier use from another period is ignored, and a negative one is allowed', () => {
  const days = daysFrom(Object.fromEntries([nov(10, 5e9)]));
  const now = new Date(2026, 10, 13);
  assert.equal(budgetState({ settings: settings({ budgetGB: 50, overhead: 0 }), days, carrier: { period: '2026-10-01', other: 9e9 }, now }).used, 5e9);
  assert.equal(budgetState({ settings: settings({ budgetGB: 50, overhead: 0 }), days, carrier: { period: '2026-11-01', other: -1e9 }, now }).used, 4e9);
});

test('pace is unknown before two measured days, and days before Sip started don\'t count', () => {
  const days = daysFrom(Object.fromEntries([nov(12, 3e9), nov(13, 1e9)]));
  const s = budgetState({ settings: settings({ budgetGB: 50 }), days, now: new Date(2026, 10, 13) });
  assert.equal(s.rate, null);
  assert.equal(s.pace, 'unknown');
  assert.equal(s.projected, null);
});

test('without a budget there is no share, pace or level', () => {
  const s = budgetState({ settings: settings({}), days: daysFrom(Object.fromEntries([nov(13, 1e9)])), now: new Date(2026, 10, 13) });
  assert.equal(s.budget, 0);
  assert.equal(s.share, 0);
  assert.equal(s.pace, null);
  assert.equal(s.level, 'none');
  assert.equal(s.today, 1.05e9);
});

test('over budget', () => {
  const s = budgetState({ settings: settings({ budgetGB: 10, overhead: 0 }), days: daysFrom(Object.fromEntries([nov(5, 11e9)])), now: new Date(2026, 10, 13) });
  assert.equal(s.left, -1e9);
  assert.equal(s.level, 'over');
  assert.equal(s.pace, 'over');
  assert.equal(s.share, 0);
});

test('warning levels', () => {
  assert.equal(warningLevel(50, 0), 0);
  assert.equal(warningLevel(70, 100), 0);
  assert.equal(warningLevel(80, 100), 0.75);
  assert.equal(warningLevel(95, 100), 0.9);
  assert.equal(warningLevel(130, 100), 1);
});
