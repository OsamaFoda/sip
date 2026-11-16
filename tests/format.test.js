import test from 'node:test';
import assert from 'node:assert/strict';
import { compactBytes, formatBytes, formatCount, formatDate, formatSigned, makeFormatter } from '../lib/format.js';
import { useLanguage } from './helpers.js';

test('sizes are decimal and switch units after rounding', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1000), '1 KB');
  assert.equal(formatBytes(999_600), '1.0 MB');
  assert.equal(formatBytes(3.5e6), '3.5 MB');
  assert.equal(formatBytes(9.96e6), '10 MB');
  assert.equal(formatBytes(410e6), '410 MB');
  assert.equal(formatBytes(999.6e6), '1.00 GB');
  assert.equal(formatBytes(1.25e9), '1.25 GB');
  assert.equal(formatBytes(150.25e9), '150.3 GB');
  assert.equal(formatBytes(1234.5e9), '1.23 TB');
});

test('the badge stays within four characters', () => {
  assert.equal(compactBytes(0), '0M');
  assert.equal(compactBytes(312e6), '312M');
  assert.equal(compactBytes(949e6), '949M');
  assert.equal(compactBytes(950e6), '1.0G');
  assert.equal(compactBytes(2.4e9), '2.4G');
  assert.equal(compactBytes(9.97e9), '10G');
  assert.equal(compactBytes(14e9), '14G');
  assert.equal(compactBytes(5e12), '5T');
});

test('signed sizes, counts and dates', () => {
  assert.equal(formatSigned(1.2e9), '+1.20 GB');
  assert.equal(formatSigned(-400e6), '−400 MB');
  assert.equal(formatCount(1204), '1,204');
  assert.equal(formatDate('2026-12-01'), '1 Dec');
});

test('Arabic uses its own units and keeps Western digits', () => {
  const fmt = useLanguage('ar');
  assert.equal(formatBytes(1.42e9, fmt), '1.42 جيجا');
  assert.equal(formatBytes(512, fmt), '512 بايت');
  assert.match(formatDate('2026-12-01', fmt), /^1 /);
  assert.equal(makeFormatter('ar').locale, 'ar-u-nu-latn');
});
