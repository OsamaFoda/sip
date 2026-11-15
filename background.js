// Meters every response the browser receives, keeps per-day totals by site,
// applies the saver rules, and warns as the monthly budget runs out.

import {
  DEFAULT_SETTINGS, GB, addUsage, allowPatterns, billingPeriod, buildRules, compactBytes, dayKey,
  exactBytes, formatBytes, hostOf, prune, responseBytes, sumRange, warningLevel,
} from './lib.js';

const api = globalThis.browser ?? globalThis.chrome;

let days = {};           // dayKey -> { total, sites: { host: bytes } }
let settings = { ...DEFAULT_SETTINGS };
let notified = {};       // billing period start -> highest warning level already shown
const tabSite = new Map(); // tabId -> host of the page open in that tab
const unsized = new Map(); // url -> where to add its body size once the page reports it
let flushTimer = null;

const ready = (async () => {
  const stored = await api.storage.local.get(['days', 'settings', 'notified']);
  days = stored.days || {};
  notified = stored.notified || {};
  settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  // The content script reads settings straight from storage, so make sure they exist there.
  if (!stored.settings) await api.storage.local.set({ settings });
  prune(days);
  await applyRules();
  await applyScripts();
  updateBadge();
})();

// Listeners are registered synchronously so Chrome's service worker wakes up for them.

api.webRequest.onBeforeRequest.addListener(
  d => { if (d.tabId >= 0) tabSite.set(d.tabId, hostOf(d.url)); },
  { urls: ['<all_urls>'], types: ['main_frame'] },
);

api.webRequest.onCompleted.addListener(
  d => { ready.then(() => record(d)); },
  { urls: ['<all_urls>'] },
  ['responseHeaders'],
);

// A transfer stopped partway (a closed tab, a skipped video) still cost what arrived.
api.webRequest.onErrorOccurred.addListener(
  d => { ready.then(() => { if (exactBytes(d) !== null) record(d); }); },
  { urls: ['<all_urls>'] },
);

api.tabs.onRemoved.addListener(tabId => tabSite.delete(tabId));

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'flush') {
    ready.then(flush).then(() => sendResponse(true));
    return true;
  }
  if (msg?.type === 'clear') {
    ready.then(async () => {
      days = {};
      notified = {};
      unsized.clear();
      await api.storage.local.set({ days, notified });
      updateBadge();
      sendResponse(true);
    });
    return true;
  }
  if (msg?.type === 'sizes' && Array.isArray(msg.entries)) {
    ready.then(() => fillSizes(msg.entries));
  }
  return false;
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  ready.then(async () => {
    await applyRules();
    await applyScripts();
    updateBadge();
    checkBudget();
  });
});

// Requests belong to the page they were made for, not to the CDN that served them.
function siteFor(d) {
  if (d.tabId >= 0 && tabSite.get(d.tabId)) return tabSite.get(d.tabId);
  return hostOf(d.documentUrl || d.originUrl || d.initiator || d.url);
}

function record(d) {
  const site = siteFor(d);
  if (!site) return;
  const exact = exactBytes(d);
  if (exact !== null) {
    addUsage(days, dayKey(), site, exact);
    scheduleFlush();
    return;
  }
  const { bytes, headerBytes, known } = responseBytes(d);
  const day = dayKey();
  addUsage(days, day, site, bytes);
  if (!known) unsized.set(d.url, { day, site, headerBytes, time: Date.now() });
  scheduleFlush();
}

// The content script reports transferSize for resources it can see; use it for responses
// that arrived without a Content-Length. Matches older than a minute are dropped.
function fillSizes(entries) {
  const now = Date.now();
  for (const [url, info] of unsized) {
    if (now - info.time > 60000) unsized.delete(url);
  }
  for (const [url, size] of entries) {
    const info = unsized.get(url);
    if (!info || !(size > 0)) continue;
    unsized.delete(url);
    addUsage(days, info.day, info.site, Math.max(0, size - info.headerBytes));
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, 3000);
}

async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  await api.storage.local.set({ days });
  updateBadge();
  checkBudget();
}

function periodUsage(now = new Date()) {
  const period = billingPeriod(now, settings.resetDay);
  return { ...period, ...sumRange(days, dayKey(period.start), dayKey(period.end)) };
}

// The autoplay blocker is a registered content script rather than a static one, so it runs
// only where it should and doesn't have to wait for settings before acting.
async function applyScripts() {
  const ids = (await api.scripting.getRegisteredContentScripts()).map(s => s.id);
  if (ids.length) await api.scripting.unregisterContentScripts({ ids });
  if (!settings.saver || !settings.autoplay) return;
  await api.scripting.registerContentScripts([{
    id: 'autoplay',
    js: ['autoplay.js'],
    matches: ['<all_urls>'],
    excludeMatches: allowPatterns(settings.allow),
    runAt: 'document_start',
    allFrames: true,
  }]);
}

async function applyRules() {
  const existing = await api.declarativeNetRequest.getDynamicRules();
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: buildRules(settings),
  });
}

function updateBadge() {
  const budget = settings.budgetGB * GB;
  let text, color;
  if (budget) {
    const ratio = periodUsage().total / budget;
    text = `${Math.floor(ratio * 100)}%`;
    color = ratio >= 0.9 ? '#c5221f' : ratio >= 0.75 ? '#b06000' : '#137333';
  } else {
    text = compactBytes(days[dayKey()]?.total || 0);
    color = '#3c4043';
  }
  api.action.setBadgeText({ text });
  api.action.setBadgeBackgroundColor({ color });
}

function checkBudget() {
  const budget = settings.budgetGB * GB;
  if (!settings.notify || !budget) return;
  const period = periodUsage();
  const level = warningLevel(period.total, budget);
  const key = dayKey(period.start);
  if (level <= (notified[key] || 0)) return;
  notified = { [key]: level };
  api.storage.local.set({ notified });
  const left = Math.max(0, budget - period.total);
  api.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: level >= 1 ? 'Data budget used up' : `${Math.round(level * 100)}% of your data budget used`,
    message: level >= 1
      ? `You've used ${formatBytes(period.total)} of ${settings.budgetGB} GB this period.`
      : `${formatBytes(left)} left for the next ${period.daysLeft} days.`,
  });
}
