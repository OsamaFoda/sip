// Days left in the period, across Egypt's clock changes.
process.env.TZ = 'Africa/Cairo';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingPeriod } from '../lib/period.js';
import { dayKey } from '../lib/store.js';

test('days left counts calendar days across the spring clock change', () => {
  // Clocks jump from midnight to 1:00 on Friday 24 April 2026.
  assert.equal(billingPeriod(new Date(2026, 3, 23, 23, 30), 25).daysLeft, 2);
});

test('days left counts calendar days across the autumn clock change', () => {
  // Clocks go back an hour at the end of Thursday 29 October 2026.
  assert.equal(billingPeriod(new Date(2026, 9, 29, 0, 30), 31).daysLeft, 2);
});

test('periods of N days keep their dates across a clock change', () => {
  const p = billingPeriod(new Date(2026, 3, 26, 10), { kind: 'days', every: 7, from: '2026-04-20' });
  assert.equal(dayKey(p.start), '2026-04-20');
  assert.equal(dayKey(p.end), '2026-04-27');
  assert.equal(p.daysLeft, 1);
});
