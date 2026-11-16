import test from 'node:test';
import assert from 'node:assert/strict';
import { planRuleUpdate, planScriptUpdate } from '../lib/apply.js';
import { buildRules, buildScripts } from '../lib/savers.js';
import { loadSettings } from '../lib/settings.js';

const settings = patch => ({ ...loadSettings({}), ...patch });

test('nothing to do when the browser already has the rules and scripts', () => {
  const rules = buildRules(settings({ images: true }));
  assert.equal(planRuleUpdate(rules, rules), null);
  // The browser may report fields Sip didn't set, at their defaults.
  const reported = rules.map(r => ({ ...r, condition: { ...r.condition, isUrlFilterCaseSensitive: false } }));
  assert.equal(planRuleUpdate(reported, rules), null);
  const scripts = buildScripts(settings({}));
  const registered = scripts.map(s => ({ world: 'ISOLATED', excludeMatches: [], matchOriginAsFallback: false, ...s }));
  assert.equal(planScriptUpdate(registered, scripts), null);
});

test('only what changed is updated', () => {
  const before = buildRules(settings({}));
  const after = buildRules(settings({ images: true }));
  assert.deepEqual(planRuleUpdate(before, after), { removeRuleIds: [], addRules: [after[1]] });
  assert.deepEqual(planRuleUpdate(after, before), { removeRuleIds: [2], addRules: [] });
});

test('a dropped exclusion list is noticed', () => {
  const before = buildRules(settings({ sites: { 'a.test': { trackers: false } } }));
  const after = buildRules(settings({}));
  assert.deepEqual(planRuleUpdate(before, after), { removeRuleIds: [1], addRules: after });
});

test('a changed script is registered again under its id', () => {
  const before = buildScripts(settings({}));
  const after = buildScripts(settings({ youtube: 720 }));
  assert.deepEqual(planScriptUpdate(before, after), { unregister: ['youtube-player'], register: [after[3]] });
  assert.deepEqual(planScriptUpdate(before, buildScripts(settings({ youtube: 0 }))), { unregister: ['youtube-quality', 'youtube-player'], register: [] });
});
