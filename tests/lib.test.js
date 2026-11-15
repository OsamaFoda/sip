import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, GB, KB, MB, addUsage, allowPatterns, billingPeriod, buildRules, compactBytes, dayKey,
  exactBytes, formatBytes, hostOf, isAllowed, prune, responseBytes, sumRange, warningLevel,
} from '../lib.js';

const headers = obj => Object.entries(obj).map(([name, value]) => ({ name, value }));

test('responseBytes uses Content-Length plus header text', () => {
  const r = responseBytes({ statusLine: 'HTTP/1.1 200 OK', statusCode: 200, responseHeaders: headers({ 'Content-Length': '5000' }) });
  assert.equal(r.known, true);
  assert.ok(r.bytes > 5000 && r.bytes < 5100);
});

test('responseBytes flags responses with no length', () => {
  const r = responseBytes({ statusCode: 200, responseHeaders: headers({ 'Transfer-Encoding': 'chunked' }) });
  assert.equal(r.known, false);
  assert.ok(r.headerBytes > 0);
});

test('responseBytes counts cache hits as free and 304s as headers only', () => {
  assert.deepEqual(responseBytes({ fromCache: true, responseHeaders: headers({ 'content-length': '9000' }) }),
    { bytes: 0, headerBytes: 0, known: true });
  const r = responseBytes({ statusCode: 304, responseHeaders: headers({ ETag: 'x' }) });
  assert.equal(r.known, true);
  assert.ok(r.bytes < 100);
});

test('hostOf strips www and ignores non-web URLs', () => {
  assert.equal(hostOf('https://www.youtube.com/watch?v=1'), 'youtube.com');
  assert.equal(hostOf('moz-extension://abc/popup.html'), '');
  assert.equal(hostOf('not a url'), '');
});

test('isAllowed covers subdomains but not lookalikes', () => {
  assert.ok(isAllowed('m.youtube.com', ['youtube.com']));
  assert.ok(!isAllowed('notyoutube.com', ['youtube.com']));
});

test('usage adds up per day and per site, and old days are pruned', () => {
  const days = {};
  addUsage(days, '2026-11-01', 'a.com', 10);
  addUsage(days, '2026-11-01', 'a.com', 5);
  addUsage(days, '2026-11-02', 'b.com', 7);
  addUsage(days, '2026-08-01', 'old.com', 99);
  assert.deepEqual(sumRange(days, '2026-11-01', '2026-11-03'), { total: 22, sites: { 'a.com': 15, 'b.com': 7 } });
  prune(days, new Date(2026, 10, 12));
  assert.equal(days['2026-08-01'], undefined);
  assert.equal(days['2026-11-01'].total, 15);
});

test('billing period before and after the reset day', () => {
  let p = billingPeriod(new Date(2026, 10, 12, 15), 20);
  assert.equal(dayKey(p.start), '2026-10-20');
  assert.equal(dayKey(p.end), '2026-11-20');
  assert.equal(p.daysLeft, 8);

  p = billingPeriod(new Date(2026, 10, 20, 0, 5), 20);
  assert.equal(dayKey(p.start), '2026-11-20');
});

test('billing period clamps a 31st reset day to short months', () => {
  const p = billingPeriod(new Date(2027, 1, 10), 31);
  assert.equal(dayKey(p.start), '2027-01-31');
  assert.equal(dayKey(p.end), '2027-02-28');
});

test('billing period wraps across the new year', () => {
  const p = billingPeriod(new Date(2027, 0, 3), 15);
  assert.equal(dayKey(p.start), '2026-12-15');
  assert.equal(dayKey(p.end), '2027-01-15');
});

test('warning levels', () => {
  assert.equal(warningLevel(50, 0), 0);
  assert.equal(warningLevel(70, 100), 0);
  assert.equal(warningLevel(80, 100), 0.75);
  assert.equal(warningLevel(95, 100), 0.9);
  assert.equal(warningLevel(130, 100), 1);
});

test('byte formatting', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(3.5 * MB), '3.5 MB');
  assert.equal(formatBytes(1.25 * GB), '1.25 GB');
  assert.equal(formatBytes(GB - 20 * MB), '0.98 GB');
  assert.equal(compactBytes(312 * MB), '312M');
  assert.equal(compactBytes(2.4 * GB), '2.4G');
  assert.equal(compactBytes(14 * GB), '14G');
});

test('rules follow the settings', () => {
  assert.deepEqual(buildRules({ ...DEFAULT_SETTINGS, saver: false }), []);

  const rules = buildRules({ ...DEFAULT_SETTINGS, images: true, allow: ['youtube.com'] });
  assert.deepEqual(rules.map(r => r.id), [1, 2]);
  const tracker = rules[0];
  assert.equal(tracker.condition.domainType, 'thirdParty');
  assert.ok(tracker.condition.requestDomains.includes('doubleclick.net'));
  assert.ok(tracker.condition.requestDomains.every(d => !d.includes('/')));
  assert.deepEqual(rules[1].condition.excludedInitiatorDomains, ['youtube.com']);

  // An empty allow list must not produce an empty exclusion array, which Chrome rejects.
  const plain = buildRules(DEFAULT_SETTINGS);
  assert.equal('excludedInitiatorDomains' in plain[0].condition, false);
});

test('allow patterns cover subdomains, and IP addresses exactly', () => {
  assert.deepEqual(allowPatterns(['youtube.com', '127.0.0.1']), ['*://*.youtube.com/*', '*://127.0.0.1/*']);
});

test('exactBytes uses what Firefox counted, sent and received', () => {
  assert.equal(exactBytes({ responseSize: 5300, requestSize: 420, statusCode: 200 }), 5720);
  assert.equal(exactBytes({ responseSize: 350143, requestSize: 400 }), 350543); // stopped partway
  assert.equal(exactBytes({ responseSize: 0, requestSize: 0, fromCache: true, statusCode: 200 }), 0);
  assert.equal(exactBytes({ responseSize: 0, requestSize: 300, statusCode: 304 }), 300);
});

test('exactBytes falls back where the browser gives no size, or a suspicious zero', () => {
  assert.equal(exactBytes({ statusCode: 200 }), null);                    // Chrome
  assert.equal(exactBytes({ responseSize: 0, statusCode: 200 }), null);   // old Firefox bug
});

test('sizes just under a unit read in the bigger unit, and the badge stays within four characters', () => {
  assert.equal(formatBytes(Math.round(999.6 * KB)), '1.0 MB');
  assert.equal(compactBytes(Math.round(999.6 * MB)), '1.0G');
  assert.equal(compactBytes(Math.round(9.97 * GB)), '10G');
  assert.equal(compactBytes(500 * MB), '500M');
});
