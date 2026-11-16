import test from 'node:test';
import assert from 'node:assert/strict';
import { addSaved, addUsage, dayKey, emptyDay, mergeDay, pruneKeys, sumDays, topSites } from '../lib/store.js';

test('usage adds up per day and per site', () => {
  const days = { '2026-11-01': emptyDay(), '2026-11-02': emptyDay(), '2026-08-01': emptyDay() };
  addUsage(days['2026-11-01'], 'a.com', 10);
  addUsage(days['2026-11-01'], 'a.com', 5);
  addUsage(days['2026-11-02'], 'b.com', 7);
  addUsage(days['2026-08-01'], 'old.com', 99);
  addUsage(days['2026-11-02'], 'b.com', 0);
  addSaved(days['2026-11-02'], { req: 3, est: 900 });
  assert.deepEqual(sumDays(days, '2026-11-01', '2026-11-03'),
    { total: 22, sites: { 'a.com': 15, 'b.com': 7 }, saved: { req: 3, media: 0, est: 900 } });
});

test('days older than 62 are pruned', () => {
  const keys = ['day.2026-09-10', 'day.2026-09-11', 'day.2026-11-12', 'opt.youtube', 'summary'];
  assert.deepEqual(pruneKeys(keys, new Date(2026, 10, 12)), ['day.2026-09-10']);
});

test('merging days adds totals, sites and saved counts', () => {
  const day = { total: 5, sites: { 'a.com': 5 } };
  mergeDay(day, { total: 7, sites: { 'a.com': 2, 'b.com': 5 }, saved: { req: 1, media: 2, est: 3 } });
  assert.deepEqual(day, { total: 12, sites: { 'a.com': 7, 'b.com': 5 }, saved: { req: 1, media: 2, est: 3 } });
});

test('top sites leave the buckets out unless asked', () => {
  const sites = { 'a.com': 5, '#private': 50, 'b.com': 9, 'c.com': 9, 'd.com': 0 };
  assert.deepEqual(topSites(sites, 5), [['b.com', 9], ['c.com', 9], ['a.com', 5]]);
  assert.deepEqual(topSites(sites, 2, { buckets: true }), [['#private', 50], ['b.com', 9]]);
});

test('day keys are local dates', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
