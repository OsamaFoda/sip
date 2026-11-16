import test from 'node:test';
import assert from 'node:assert/strict';
import { billingPeriod, paceRatio, projection } from '../lib/period.js';
import { dayKey } from '../lib/store.js';

const monthly = day => ({ kind: 'monthly', day });

test('monthly period before and after the renewal day', () => {
  let p = billingPeriod(new Date(2026, 10, 12, 15), monthly(20));
  assert.equal(dayKey(p.start), '2026-10-20');
  assert.equal(dayKey(p.end), '2026-11-20');
  assert.equal(p.daysLeft, 8);
  assert.equal(p.days, 31);
  p = billingPeriod(new Date(2026, 10, 20, 0, 5), monthly(20));
  assert.equal(dayKey(p.start), '2026-11-20');
});

test('a 31st renewal day falls on the last day of short months', () => {
  const p = billingPeriod(new Date(2027, 1, 10), monthly(31));
  assert.equal(dayKey(p.start), '2027-01-31');
  assert.equal(dayKey(p.end), '2027-02-28');
});

test('monthly periods wrap across the new year, and a bare number is a monthly day', () => {
  const p = billingPeriod(new Date(2027, 0, 3), 15);
  assert.equal(dayKey(p.start), '2026-12-15');
  assert.equal(dayKey(p.end), '2027-01-15');
});

test('periods of N days run on from their start date, across month ends', () => {
  const period = { kind: 'days', every: 30, from: '2026-10-20' };
  let p = billingPeriod(new Date(2026, 10, 25, 9), period);
  assert.equal(dayKey(p.start), '2026-11-19');
  assert.equal(dayKey(p.end), '2026-12-19');
  assert.equal(p.daysLeft, 24);
  p = billingPeriod(new Date(2026, 9, 1), period);   // before the first one: the period before it
  assert.equal(dayKey(p.start), '2026-09-20');
  p = billingPeriod(new Date(2026, 10, 3), { kind: 'days', every: 7, from: '2026-10-27' });
  assert.equal(dayKey(p.start), '2026-11-03');
  assert.equal(p.daysLeft, 7);
});

test('pace ratio is the share of the period gone by', () => {
  assert.equal(paceRatio(new Date(2026, 10, 16), monthly(1)), 0.5);
  assert.equal(paceRatio(new Date(2026, 10, 1), monthly(1)), 0);
});

test('projection needs two full days, and runs out only before the renewal', () => {
  const now = new Date(2026, 10, 13, 12);
  assert.deepEqual(projection([1e9], 10e9, now, monthly(1)), { runOut: null, daysEarly: 0, rate: null });
  assert.equal(projection([0, 0], 10e9, now, monthly(1)).runOut, null);
  const fast = projection([2e9, 2e9], 10e9, now, monthly(1), 1e9);
  assert.equal(fast.rate, 2e9);
  assert.equal(dayKey(fast.runOut), '2026-11-18');   // 11 GB from this morning lasts 5.5 days
  assert.equal(fast.daysEarly, 13);
  assert.equal(projection([0.5e9, 0.5e9], 10e9, now, monthly(1)).runOut, null);
  assert.equal(dayKey(projection([1e9, 1e9], -2e9, now, monthly(1), 0).runOut), '2026-11-13');
});
