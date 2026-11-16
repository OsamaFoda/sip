import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, applyStorageChanges, diffToStorage, loadSettings, normalizeHost, normalizeSetting } from '../lib/settings.js';

test('a missing key means the default', () => {
  assert.deepEqual(loadSettings({}), structuredClone(DEFAULTS));
  assert.equal(loadSettings({ 'opt.youtube': 720 }).youtube, 720);
});

test('YouTube takes only the offered choices', () => {
  assert.equal(normalizeSetting('youtube', 144), 480);
  assert.equal(normalizeSetting('youtube', '720'), 720);
  assert.equal(normalizeSetting('youtube', 0), 0);
  assert.equal(normalizeSetting('youtube', 'abc'), 480);
});

test('the budget accepts commas, Arabic digits and nothing negative', () => {
  assert.equal(normalizeSetting('budgetGB', '-5'), 0);
  assert.equal(normalizeSetting('budgetGB', NaN), 0);
  assert.equal(normalizeSetting('budgetGB', 'lots'), 0);
  assert.equal(normalizeSetting('budgetGB', '1,5'), 1.5);
  assert.equal(normalizeSetting('budgetGB', '1,000'), 1000);
  assert.equal(normalizeSetting('budgetGB', '٥٠'), 50);
  assert.equal(normalizeSetting('budgetGB', '٢٫٥'), 2.5);
  assert.equal(normalizeSetting('budgetGB', 12.345), 12.35);
});

test('periods are clamped or fall back to the default', () => {
  assert.deepEqual(normalizeSetting('period', { kind: 'monthly', day: 40 }), { kind: 'monthly', day: 31 });
  assert.deepEqual(normalizeSetting('period', 7), { kind: 'monthly', day: 7 });
  assert.deepEqual(normalizeSetting('period', { kind: 'days', every: 0, from: '2026-11-01' }), { kind: 'days', every: 1, from: '2026-11-01' });
  assert.deepEqual(normalizeSetting('period', { kind: 'days', every: 90, from: '2026-11-01' }), { kind: 'days', every: 60, from: '2026-11-01' });
  assert.deepEqual(normalizeSetting('period', { kind: 'days', every: 30, from: '2026-02-30' }), DEFAULTS.period);
  assert.deepEqual(normalizeSetting('period', { kind: 'weekly' }), DEFAULTS.period);
});

test('overhead, language and booleans', () => {
  assert.equal(normalizeSetting('overhead', 25), 20);
  assert.equal(normalizeSetting('overhead', 2.3), 2.5);
  assert.equal(normalizeSetting('overhead', -1), 0);
  assert.equal(normalizeSetting('lang', 'fr'), 'auto');
  assert.equal(normalizeSetting('notify', 'false'), false);
  assert.equal(normalizeSetting('images', 1), true);
  assert.throws(() => normalizeSetting('colour', 1), RangeError);
});

test('site rules: normalized hosts, booleans only, empty ones dropped', () => {
  const sites = normalizeSetting('sites', {
    'WWW.Example.com': { images: true, fonts: 'yes' },
    'https://m.reddit.com/r/x': { trackers: false },
    'not a host': { images: true },
    'empty.com': {},
    'nothing.com': { colour: true },
  });
  assert.deepEqual(sites, { 'example.com': { images: true }, 'm.reddit.com': { trackers: false } });
  const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`s${i}.com`, { images: true }]));
  assert.equal(Object.keys(normalizeSetting('sites', many)).length, 500);
});

test('hosts', () => {
  assert.equal(normalizeHost(' Www.YouTube.com '), 'youtube.com');
  assert.equal(normalizeHost('localhost:8080'), 'localhost');
  assert.equal(normalizeHost('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeHost('https://news.bbc.co.uk/x?y'), 'news.bbc.co.uk');
  assert.equal(normalizeHost('bad_host!'), '');
  assert.equal(normalizeHost('x'.repeat(254)), '');
});

test('only what changed is written, and defaults are removed instead', () => {
  const current = loadSettings({ 'opt.images': true });
  const { set, remove, settings } = diffToStorage({ images: false, youtube: 360, autoplay: true }, current);
  assert.deepEqual(set, { 'opt.youtube': 360 });
  assert.deepEqual(remove, ['opt.images']);
  assert.equal(settings.youtube, 360);
});

test('a removed key reads as the default again', () => {
  const current = loadSettings({ 'opt.youtube': 1080 });
  const { settings, changed } = applyStorageChanges(current, { 'opt.youtube': { oldValue: 1080 }, 'day.2026-11-01': { newValue: {} } });
  assert.equal(settings.youtube, 480);
  assert.deepEqual(changed, ['youtube']);
});
