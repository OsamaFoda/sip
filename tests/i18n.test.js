import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMessages, substitute, t } from '../lib/i18n.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const messages = lang => JSON.parse(readFileSync(join(root, '_locales', lang, 'messages.json'), 'utf8'));

test('_locales is up to date with locales/ and both languages agree', () => {
  execFileSync('python3', [join(root, 'tools', 'build.py'), '--check'], { stdio: 'pipe' });
});

test('substitutions work the way browser.i18n does', () => {
  assert.equal(substitute('$1 left of $2', ['5 GB', '50 GB']), '5 GB left of 50 GB');
  assert.equal(substitute('$$1 costs $1', ['x']), '$1 costs x');
  setMessages({ hi: { message: 'Hi $1' } }, 'en');
  assert.equal(t('hi', ['Osama']), 'Hi Osama');
  assert.equal(t('missing_key'), 'missing_key');
});

test('plural sets are complete', () => {
  const sets = (dict, base) => Object.keys(dict).filter(k => k.startsWith(base + '__')).map(k => k.split('__')[1]).sort();
  const en = messages('en');
  const ar = messages('ar');
  for (const base of new Set(Object.keys(en).filter(k => k.includes('__')).map(k => k.split('__')[0]))) {
    assert.deepEqual(sets(en, base), ['one', 'other'], base);
    assert.deepEqual(sets(ar, base), ['few', 'many', 'one', 'other', 'two', 'zero'], base);
  }
});

// Every key the code asks for exists (plural keys by their base).
test('every string the code uses exists', () => {
  const en = messages('en');
  const bases = new Set(Object.keys(en).map(k => k.split('__')[0]));
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (['node_modules', 'dist', 'tests', 'tools', '.git', '_locales', 'locales'].includes(name)) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|html)$/.test(name)) files.push(path);
    }
  };
  walk(root);
  const missing = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, key] of text.matchAll(/\b(?:t|plural)\(\s*'([a-zA-Z0-9_]+)'/g)) if (!bases.has(key)) missing.push(`${file}: ${key}`);
    for (const [, key] of text.matchAll(/data-i18n="([a-zA-Z0-9_]+)"/g)) if (!bases.has(key)) missing.push(`${file}: ${key}`);
    for (const [, list] of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of list.split(';')) if (!bases.has(pair.split(':')[1])) missing.push(`${file}: ${pair}`);
    }
  }
  assert.deepEqual(missing, []);
});
