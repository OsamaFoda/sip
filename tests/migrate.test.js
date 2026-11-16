import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImport, isLegacy, migrate } from '../lib/migrate.js';

const now = new Date(2026, 10, 16);
const v1 = () => ({
  days: {
    '2026-11-15': { total: 900, sites: { 'a.com': 900 } },
    '2026-11-16': { total: 100, sites: { 'b.com': 100 } },
    '2026-08-01': { total: 5, sites: { 'old.com': 5 } },
  },
  settings: { saver: true, autoplay: true, trackers: true, images: true, fonts: false, youtube: 360, allow: ['www.Shop.com'], budgetGB: 50, resetDay: 7, notify: true },
  notified: { '2026-11-07': 0.75 },
});

test('v1 storage is recognised', () => {
  assert.ok(isLegacy(v1()));
  assert.ok(!isLegacy({ schema: 2, days: {} }));
  assert.ok(!isLegacy({}));
});

test('v1 moves to one key per day and per setting, field by field', () => {
  const { set, remove } = migrate(v1(), now);
  assert.deepEqual(set, {
    schema: 2,
    'day.2026-11-15': { total: 900, sites: { 'a.com': 900 } },
    'day.2026-11-16': { total: 100, sites: { 'b.com': 100 } },
    'opt.images': true,
    'opt.youtube': 360,
    'opt.budgetGB': 50,
    'opt.period': { kind: 'monthly', day: 7 },
    'opt.sites': { 'shop.com': { autoplay: false, trackers: false, images: false, fonts: false } },
    warned: { period: '2026-11-07', level: 0.75, paceDay: null },
  });
  assert.deepEqual(remove, ['days', 'settings', 'notified']);
});

test('defaults are not written', () => {
  const { set } = migrate({ settings: { saver: true, autoplay: true, youtube: 480, budgetGB: 0, resetDay: 1, allow: [] } }, now);
  assert.deepEqual(set, { schema: 2 });
});

test('a crash between the write and the remove only repeats the remove', () => {
  const { set } = migrate(v1(), now);
  const both = { ...v1(), ...set };
  assert.deepEqual(migrate(both, now), { set: {}, remove: ['days', 'settings', 'notified'] });
});

const current = () => ({
  schema: 2,
  'day.2026-11-16': { total: 50, sites: { 'b.com': 50 }, saved: { req: 2, media: 0, est: 0 } },
  'opt.youtube': 1080,
  ack: { carrier: 'c1' },
});

test('an import adds the old days, fills missing settings, and acks', () => {
  const cmd = { id: 'u1', from: 'sip@osama.local', at: 1, data: v1() };
  const { set, remove } = applyImport(current(), cmd, now);
  assert.deepEqual(set['day.2026-11-16'], { total: 150, sites: { 'b.com': 150 }, saved: { req: 2, media: 0, est: 0 } });
  assert.deepEqual(set['day.2026-11-15'], { total: 900, sites: { 'a.com': 900 } });
  assert.equal(set['day.2026-08-01'], undefined);
  assert.equal(set['opt.youtube'], undefined, 'a setting already chosen here keeps its value');
  assert.equal(set['opt.budgetGB'], 50);
  assert.deepEqual(set.warned, { period: '2026-11-07', level: 0.75, paceDay: null });
  assert.deepEqual(set.ack, { carrier: 'c1', import: 'u1' });
  assert.deepEqual(remove, ['cmd.import']);
});

test('the same import twice adds once', () => {
  const cmd = { id: 'u1', data: v1() };
  const first = applyImport(current(), cmd, now);
  const after = { ...current(), ...first.set };
  assert.deepEqual(applyImport(after, cmd, now), { set: {}, remove: ['cmd.import'] });
});

test('a v1 and a v2 payload give the same result', () => {
  const asV2 = migrate(v1(), now).set;
  const a = applyImport(current(), { id: 'x', data: v1() }, now);
  const b = applyImport(current(), { id: 'x', data: asV2 }, now);
  assert.deepEqual(a, b);
});
