// Plans for bringing the browser's registered rules and content scripts in line with what the
// settings want, touching only what differs. No plan (null) means nothing to call, so a
// background that wakes up costs two reads and no writes.

// Fields the browser may report that weren't set: equal to the defaults, they don't count.
const ignorable = value => value === undefined || value === null || value === false || value === '' ||
  (Array.isArray(value) && value.length === 0);

// True when `have` (from the browser) is what `want` describes. Extra fields in `have` count
// only when they hold something, so a dropped exclusion list is noticed.
export function same(have, want) {
  if (Array.isArray(want)) {
    return Array.isArray(have) && have.length === want.length && want.every((w, i) => same(have[i], w));
  }
  if (want && typeof want === 'object') {
    if (!have || typeof have !== 'object' || Array.isArray(have)) return false;
    for (const key of Object.keys(want)) if (!same(have[key], want[key])) return false;
    for (const key of Object.keys(have)) if (!(key in want) && !ignorable(have[key])) return false;
    return true;
  }
  return have === want;
}

// { removeRuleIds, addRules } for updateDynamicRules, or null.
export function planRuleUpdate(current, desired) {
  const want = new Map(desired.map(rule => [rule.id, rule]));
  const have = new Map(current.map(rule => [rule.id, rule]));
  const removeRuleIds = current.filter(rule => !want.has(rule.id) || !same(rule, want.get(rule.id))).map(rule => rule.id);
  const addRules = desired.filter(rule => !have.has(rule.id) || !same(have.get(rule.id), rule));
  return removeRuleIds.length || addRules.length ? { removeRuleIds, addRules } : null;
}

const SCRIPT_DEFAULTS = { allFrames: false, runAt: 'document_idle', world: 'ISOLATED', persistAcrossSessions: true, excludeMatches: [], css: [], js: [] };
const withDefaults = script => ({ ...SCRIPT_DEFAULTS, ...script });

// { unregister: [ids], register: [scripts] }, or null. A changed script is unregistered and
// registered again under the same id.
export function planScriptUpdate(current, desired) {
  const want = new Map(desired.map(s => [s.id, s]));
  const have = new Map(current.map(s => [s.id, s]));
  const unregister = current.filter(s => !want.has(s.id) || !same(withDefaults(s), withDefaults(want.get(s.id)))).map(s => s.id);
  const register = desired.filter(s => !have.has(s.id) || unregister.includes(s.id));
  return unregister.length || register.length ? { unregister, register } : null;
}
