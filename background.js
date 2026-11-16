// Sip's background: meters every request, keeps per-day totals by site, applies the savers,
// publishes the summary that every surface reads, and warns as the budget runs out.

import { applyStorageChanges, diffToStorage, loadSettings, normalizeHost, normalizeSetting } from './lib/settings.js';
import { addSaved, addUsage, dayKey, dayOfStorageKey, dayStorageKey, emptyDay, isDayKey, mergeDay, pruneKeys } from './lib/store.js';
import { DNR_BLOCK_ERROR, exactBytes, hostOf, kindOf, responseBytes, siteOf } from './lib/meter.js';
import { budgetState } from './lib/budget.js';
import { badgeFor, notificationFor, summaryFrom } from './lib/summary.js';
import { buildView } from './lib/view.js';
import { MSG } from './lib/messages.js';
import { applyImport, isLegacy, migrate, SCHEMA } from './lib/migrate.js';
import { applyLevel, buildRules, buildScripts, effective, LEVEL_NAMES, wouldBlock } from './lib/savers.js';
import { initI18n, t, uiLocale } from './lib/i18n.js';
import { makeFormatter } from './lib/format.js';
import { planRuleUpdate, planScriptUpdate } from './lib/apply.js';

const api = globalThis.browser ?? globalThis.chrome;
// Firefox reports exact sizes and the frame a request belongs to; Chrome needs content.js.
const IS_FIREFOX = typeof globalThis.browser?.runtime?.getBrowserInfo === 'function';
const FLUSH_MS = 20000;
const MIN_SAMPLES = 30;     // blocked requests get an estimated size once a kind has this many samples
const MAX_SAMPLES = 10000;  // then the running sums are halved, so the average follows recent pages
const SAVER_KEYS = ['saver', 'autoplay', 'trackers', 'images', 'fonts', 'saveData', 'youtube', 'sites'];
const AVG_KIND = { trackers: 'tracker', images: 'image', fonts: 'font' };

let settings = loadSettings({});
const days = {};            // dayKey -> { total, sites, saved? }, the kept window
const dirty = new Set();    // day keys changed since the last flush
let carrier = null;
let warned = null;
let stats = { image: [0, 0], font: [0, 0], tracker: [0, 0] };
let statsDirty = false;
let ack = {};
let hostMark = null;        // "astrelle" once Astrelle has said so
let fmt = makeFormatter('en', t);
let flushTimer = null;
let held = null;            // while stored days are being replaced: requests to add afterwards
let lastSummary = '';
let lastBadge = '';
let debugCounts = null;
const tabSite = new Map();  // Chrome: tabId -> the site open in it
const unsized = new Map();  // Chrome: url -> where to add its body size once the page reports it

// Storage writes that replace what's stored run one at a time, in order.
let chain = Promise.resolve();
function serial(task) {
  const run = chain.then(task);
  chain = run.catch(error => console.error('Sip:', error));
  return run;
}
// Rule and script updates have their own chain.
let applying = Promise.resolve();
function reconcile() {
  const run = applying.then(applyNow);
  applying = run.catch(error => console.error('Sip:', error));
  return run;
}

// Test-only (opt.debug): count the writes, so the e2e checks can see there's no churn.
function count(kind) {
  if (!settings.debug) return;
  debugCounts ??= {};
  debugCounts[kind] = (debugCounts[kind] || 0) + 1;
  api.storage.session?.set({ debug: debugCounts }).catch(() => {});
}
function localSet(items) {
  count('set');
  return api.storage.local.set(items);
}

function load(stored) {
  settings = loadSettings(stored);
  for (const key of Object.keys(days)) delete days[key];
  for (const [key, value] of Object.entries(stored)) {
    if (isDayKey(key)) days[dayOfStorageKey(key)] = value;
  }
  carrier = stored.carrier ?? null;
  warned = stored.warned ?? null;
  stats = stored['stats.avg'] ?? { image: [0, 0], font: [0, 0], tracker: [0, 0] };
  ack = stored.ack ?? {};
  hostMark = stored.host ?? null;
}

const ready = (async () => {
  let stored = await api.storage.local.get(null);
  if (isLegacy(stored) || (stored.schema === SCHEMA && ['days', 'settings', 'notified'].some(k => k in stored))) {
    const { set, remove } = migrate(stored, new Date());
    if (Object.keys(set).length) await localSet(set);
    if (remove.length) await api.storage.local.remove(remove);
    stored = await api.storage.local.get(null);
  } else if (stored.schema === undefined) {
    await localSet({ schema: SCHEMA });
  }
  load(stored);
  const old = pruneKeys(Object.keys(stored), new Date());
  if (old.length) {
    await api.storage.local.remove(old);
    for (const key of old) delete days[dayOfStorageKey(key)];
  }
  await setLanguage(settings.lang);
  if (settings.debug) debugCounts = (await api.storage.session.get('debug')).debug ?? {};
  if (!IS_FIREFOX) {
    const session = await api.storage.session.get(null);
    for (const [key, site] of Object.entries(session)) if (key.startsWith('tabSite.')) tabSite.set(Number(key.slice(8)), site);
  }
  armDayAlarm();
  if (stored['cmd.import']) handleImport(stored['cmd.import']);
  if (stored['cmd.carrier']) handleCarrierCommand(stored['cmd.carrier']);
  const { applied } = await api.storage.session.get('applied');
  if (!applied) reconcile();
  await flush();
})();
ready.catch(error => console.error('Sip could not start:', error));

async function setLanguage(lang) {
  await initI18n(lang);
  fmt = makeFormatter(uiLocale(), t);
}

// ----- Metering -------------------------------------------------------------------------------
// Listeners are registered synchronously so the background wakes up for them.

function add(site, bytes, saved) {
  const key = dayKey();
  if (held) {
    const day = held[key] ??= emptyDay();
    addUsage(day, site, bytes);
    if (saved) addSaved(day, saved);
    return;
  }
  const day = days[key] ??= emptyDay();
  addUsage(day, site, bytes);
  if (saved) addSaved(day, saved);
  if (bytes > 0 || saved) {
    dirty.add(key);
    scheduleFlush();
  }
}

const fallbackSite = d => (IS_FIREFOX ? undefined : tabSite.get(d.tabId));

// A running average of what images, fonts and trackers cost here, for estimating what blocking saved.
function sample(d, bytes) {
  if (d.fromCache || !(bytes > 0)) return;
  const kind = kindOf(d);
  if (!kind) return;
  const entry = stats[kind] ??= [0, 0];
  entry[0] += 1;
  entry[1] += bytes;
  if (entry[0] > MAX_SAMPLES) {
    entry[0] = Math.round(entry[0] / 2);
    entry[1] = Math.round(entry[1] / 2);
  }
  statsDirty = true;
}

function completed(d) {
  const site = siteOf(d, fallbackSite(d));
  const exact = exactBytes(d);
  if (exact !== null) {
    add(site, exact);
    sample(d, d.responseSize);
    return;
  }
  const { bytes, headerBytes, known } = responseBytes(d);
  add(site, bytes);
  sample(d, bytes);
  if (!known && !IS_FIREFOX) unsized.set(d.url, { day: dayKey(), site, headerBytes, time: Date.now() });
}

// A transfer stopped partway (a closed tab, a skipped video) still cost what arrived. A request
// Sip's own rules blocked counts as saved.
function failed(d) {
  const exact = exactBytes(d);
  if (exact) add(siteOf(d, fallbackSite(d)), exact);
  if (d.error !== DNR_BLOCK_ERROR || exact || d.statusCode) return;
  const saver = wouldBlock(d, settings);
  if (!saver) return;
  const [n, total] = stats[AVG_KIND[saver]] ?? [0, 0];
  add(siteOf(d, fallbackSite(d)), 0, { req: 1, est: n >= MIN_SAMPLES ? Math.round(total / n) : 0 });
}

// Each hop of a redirect is a response of its own.
function redirected(d) {
  const bytes = exactBytes(d) ?? responseBytes(d).bytes;
  if (bytes) add(siteOf(d, fallbackSite(d)), bytes);
}

api.webRequest.onCompleted.addListener(d => { ready.then(() => completed(d)); }, { urls: ['<all_urls>'] }, ['responseHeaders']);
api.webRequest.onErrorOccurred.addListener(d => { ready.then(() => failed(d)); }, { urls: ['<all_urls>'] });
api.webRequest.onBeforeRedirect.addListener(d => { ready.then(() => redirected(d)); }, { urls: ['<all_urls>'] }, ['responseHeaders']);

if (!IS_FIREFOX) {
  api.webRequest.onBeforeRequest.addListener(d => {
    if (d.tabId < 0) return;
    const site = hostOf(d.url);
    tabSite.set(d.tabId, site);
    api.storage.session.set({ ['tabSite.' + d.tabId]: site }).catch(() => {});
  }, { urls: ['<all_urls>'], types: ['main_frame'] });
  api.tabs.onRemoved.addListener(tabId => {
    tabSite.delete(tabId);
    api.storage.session.remove('tabSite.' + tabId).catch(() => {});
  });
}

// Chrome: content.js reports transferSize for responses that came without a Content-Length.
// Matches older than a minute are dropped.
function fillSizes(entries) {
  const now = Date.now();
  for (const [url, info] of unsized) if (now - info.time > 60000) unsized.delete(url);
  for (const [url, size] of entries) {
    const info = unsized.get(url);
    if (!info || !(size > 0)) continue;
    unsized.delete(url);
    const day = days[info.day] ??= emptyDay();
    addUsage(day, info.site, Math.max(0, size - info.headerBytes));
    dirty.add(info.day);
  }
  scheduleFlush();
}

// ----- Writing and publishing -----------------------------------------------------------------

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(() => flush(), FLUSH_MS);
}

function flush() {
  return serial(flushNow);
}

// Writes the changed days with the summary they make, in one storage call, then updates the
// badge and shows a warning if one is due.
async function flushNow() {
  clearTimeout(flushTimer);
  flushTimer = null;
  const items = {};
  for (const key of dirty) if (days[key]) items[dayStorageKey(key)] = days[key];
  dirty.clear();
  if (statsDirty) {
    items['stats.avg'] = stats;
    statsDirty = false;
  }
  const now = new Date();
  const state = budgetState({ settings, days, carrier, now });
  const summary = summaryFrom(state, settings, now, { fmt });
  const comparable = JSON.stringify({ ...summary, at: 0 });
  if (comparable !== lastSummary) {
    items.summary = summary;
    lastSummary = comparable;
  }
  const notice = notificationFor(summary, settings, warned, now, { fmt });
  if (JSON.stringify(notice.warned) !== JSON.stringify(warned)) {
    warned = notice.warned;
    items.warned = warned;
  }
  if (Object.keys(items).length) await localSet(items);
  showBadge(summary, state.todayCounted);
  if (notice.notification) {
    const { id, title, message } = notice.notification;
    api.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon-128.png', title, message });
  }
}

function showBadge(summary, todayCounted) {
  const badge = badgeFor(summary, todayCounted, { fmt });
  const key = JSON.stringify(badge);
  if (key === lastBadge) return;
  lastBadge = key;
  api.action.setBadgeText({ text: badge.text });
  api.action.setBadgeBackgroundColor({ color: badge.color });
  api.action.setBadgeTextColor?.({ color: '#ffffff' });
  api.action.setTitle({ title: badge.title });
}

// Replaces stored data: the in-memory days are written first, `compute(stored)` gives what to
// write and remove, and the days are read back from what was written. Requests that arrive
// meanwhile are held and added afterwards, so the next flush can't write an old day over it.
function rewrite(compute) {
  return serial(async () => {
    const before = JSON.stringify(settings);
    held = {};
    try {
      const items = {};
      for (const key of dirty) if (days[key]) items[dayStorageKey(key)] = days[key];
      dirty.clear();
      if (Object.keys(items).length) await localSet(items);
      const stored = await api.storage.local.get(null);
      const { set, remove } = compute(stored);
      if (Object.keys(set).length) await localSet(set);
      if (remove.length) await api.storage.local.remove(remove);
      load(await api.storage.local.get(null));
    } finally {
      const queued = held;
      held = null;
      for (const [key, day] of Object.entries(queued)) {
        mergeDay(days[key] ??= emptyDay(), day);
        dirty.add(key);
      }
    }
    if (JSON.stringify(settings) !== before) afterSettings(SAVER_KEYS.concat('lang'));
    await flushNow();
  });
}

// ----- Settings -------------------------------------------------------------------------------

async function applyNow() {
  const rules = planRuleUpdate(await api.declarativeNetRequest.getDynamicRules(), buildRules(settings));
  if (rules) {
    count('rules');
    await api.declarativeNetRequest.updateDynamicRules(rules);
  }
  const desired = buildScripts(settings);
  if (!IS_FIREFOX) desired.push({ id: 'sizes', js: ['content.js'], matches: ['<all_urls>'], allFrames: true, runAt: 'document_start', persistAcrossSessions: true });
  const scripts = planScriptUpdate(await api.scripting.getRegisteredContentScripts(), desired);
  if (scripts?.unregister.length) {
    count('unregister');
    await api.scripting.unregisterContentScripts({ ids: scripts.unregister });
  }
  if (scripts?.register.length) {
    count('register');
    await api.scripting.registerContentScripts(scripts.register);
  }
  await api.storage.session.set({ applied: true });
}

function afterSettings(changed) {
  if (changed.some(name => SAVER_KEYS.includes(name))) reconcile();
  if (changed.includes('lang')) setLanguage(settings.lang).then(() => flush());
  if (changed.includes('debug') && settings.debug) debugCounts ??= {};
}

function setSettings(patch) {
  return serial(async () => {
    const { set, remove, settings: next } = diffToStorage(patch, settings);
    settings = next;
    if (Object.keys(set).length) await localSet(set);
    if (remove.length) await api.storage.local.remove(remove);
    afterSettings([...Object.keys(set), ...remove].map(key => key.slice(4)));
    await flushNow();
    return settings;
  });
}

// "Used so far" or "carrier says left" for this period becomes other use: the part of `used`
// Sip didn't count (other devices, apps outside the browser). It can be negative, down to
// cancelling what Sip counted.
function carrierFor({ usedSoFar, leftNow }) {
  const now = new Date();
  const state = budgetState({ settings, days, carrier: null, now });
  const measured = state.counted + state.overheadBytes;
  let other;
  if (Number.isFinite(usedSoFar) && usedSoFar >= 0) other = usedSoFar - measured;
  else if (Number.isFinite(leftNow) && leftNow >= 0 && state.budget) other = state.budget - leftNow - measured;
  else throw new Error('carrier: give usedSoFar, or leftNow with a budget');
  return { period: dayKey(state.period.start), other: Math.max(-state.counted, Math.round(other)), at: now.getTime() };
}

function handleImport(cmd) {
  return rewrite(stored => applyImport(stored, cmd, new Date()));
}

function handleCarrierCommand(cmd) {
  return serial(async () => {
    if (cmd?.id && ack.carrier !== cmd.id) {
      try {
        carrier = carrierFor(cmd);
      } catch (error) {
        console.error('Sip:', error);
      }
      ack = { ...ack, carrier: cmd.id };
      await localSet({ ...(carrier ? { carrier } : {}), ack });
    }
    await api.storage.local.remove('cmd.carrier');
    await flushNow();
  });
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  ready.then(() => {
    const { settings: next, changed } = applyStorageChanges(settings, changes);
    if (changed.length) {
      settings = next;
      afterSettings(changed);
      flush();
    }
    if (changes['cmd.import']?.newValue) handleImport(changes['cmd.import'].newValue);
    if (changes['cmd.carrier']?.newValue) handleCarrierCommand(changes['cmd.carrier'].newValue);
    if (changes.host) hostMark = changes.host.newValue ?? null;
  });
});

// ----- Messages from Sip's pages and content scripts ------------------------------------------

async function managedAstrelle() {
  try {
    return (await api.storage.managed.get('astrelle')).astrelle === true;
  } catch {
    return false;   // no managed storage: not Astrelle
  }
}

async function makeView({ tabUrl, tabIncognito } = {}) {
  const [privateAllowed, hostAccess, managed] = await Promise.all([
    api.extension.isAllowedIncognitoAccess(),
    api.permissions.contains({ origins: ['<all_urls>'] }),
    managedAstrelle(),
  ]);
  return buildView({
    settings, days, carrier, now: new Date(), fmt,
    tabUrl: typeof tabUrl === 'string' ? tabUrl : undefined, tabIncognito: !!tabIncognito,
    privateAllowed, hostAccess, astrelle: managed || hostMark === 'astrelle',
  });
}

const handlers = {
  async [MSG.VIEW](msg) {
    await flush();
    return { view: await makeView(msg) };
  },
  async [MSG.SETTINGS_SET]({ patch }) {
    if (!patch || typeof patch !== 'object') throw new Error('settings.set: no patch');
    return { settings: await setSettings(patch) };
  },
  async [MSG.SITE_SET]({ host, overrides }) {
    const key = normalizeHost(host);
    if (!key) throw new Error('site.set: not a host');
    const sites = { ...settings.sites };
    if (overrides === null) delete sites[key];
    else sites[key] = overrides;
    return { settings: await setSettings({ sites: normalizeSetting('sites', sites) }) };
  },
  async [MSG.LEVEL_SET]({ level }) {
    if (!LEVEL_NAMES.includes(level)) throw new Error('level.set: no such level');
    return { settings: await setSettings(applyLevel(level)) };
  },
  async [MSG.CARRIER_SET](msg) {
    await serial(async () => {
      if (msg.clear) {
        carrier = null;
        await api.storage.local.remove('carrier');
      } else {
        carrier = carrierFor(msg);
        await localSet({ carrier });
      }
      await flushNow();
    });
    return { view: await makeView() };
  },
  async [MSG.RENEW_TODAY]() {
    const now = new Date();
    const period = settings.period.kind === 'days'
      ? { ...settings.period, from: dayKey(now) }
      : { kind: 'monthly', day: now.getDate() };
    await serial(async () => {
      carrier = null;
      await api.storage.local.remove('carrier');
    });
    return { settings: await setSettings({ period }) };
  },
  async [MSG.HISTORY_CLEAR]() {
    await rewrite(stored => ({
      set: {},
      remove: Object.keys(stored).filter(key => isDayKey(key) || ['stats.avg', 'carrier', 'warned'].includes(key)),
    }));
  },
  async [MSG.FRAME_ALLOWED](msg, sender) {
    const host = hostOf(sender?.tab?.url);
    return { autoplay: !!host && !effective(settings, host).autoplay };
  },
  [MSG.MEDIA_STOPPED]({ n }) {
    const media = Math.min(50, Math.max(0, Math.round(Number(n)) || 0));
    if (media) add('#other', 0, { media });
  },
  [MSG.SIZES]({ entries }) {
    if (Array.isArray(entries) && !IS_FIREFOX) fillSizes(entries);
  },
  async [MSG.FLUSH]() {
    await flush();
  },
};

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: 'unknown' });
    return false;
  }
  ready
    .then(() => handler(msg, sender))
    .then(reply => sendResponse({ ok: true, ...reply }), error => sendResponse({ ok: false, error: String(error?.message ?? error) }));
  return true;
});

// ----- Days, start-up and clicks --------------------------------------------------------------

function armDayAlarm() {
  const now = new Date();
  api.alarms.create('sip-day', { when: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime() });
}

api.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'sip-day') return;
  ready.then(async () => {
    await serial(async () => {
      const old = pruneKeys(Object.keys(days).map(dayStorageKey), new Date());
      if (old.length) {
        await api.storage.local.remove(old);
        for (const key of old) delete days[dayOfStorageKey(key)];
      }
      await flushNow();
    });
    armDayAlarm();
  });
});

api.runtime.onSuspend?.addListener(() => { flush(); });

// A fresh install outside Astrelle opens the first-run setup. Astrelle sets Sip up from its own
// welcome, and says so through managed storage or the `host` key.
api.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== 'install') return;
  ready.then(async () => {
    if (await managedAstrelle()) return;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (hostMark === 'astrelle' || settings.firstRunDone) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (hostMark === 'astrelle' || settings.firstRunDone) return;
    api.tabs.create({ url: api.runtime.getURL('options.html?first=1') });
  });
});

api.runtime.onStartup?.addListener(() => { ready.then(() => reconcile()); });

// Clicking a warning opens Sip: the popup, or its settings where the browser won't open a popup.
api.notifications.onClicked.addListener(() => {
  const options = () => api.runtime.openOptionsPage();
  if (api.action.openPopup) api.action.openPopup().catch(options);
  else options();
});
