// What Sip blocks and where: saving levels, per-site overrides, the declarativeNetRequest rules
// and the content scripts that follow from the settings.

import { SAVERS } from './settings.js';
import { TRACKER_HOSTS } from './trackers.js';
import { hostMatches, hostOf, isThirdParty, matchesAny } from './meter.js';

// Saving levels are derived from three savers and never stored. They leave the YouTube limit,
// web fonts, Save-Data and site rules alone.
export const LEVELS = Object.freeze({
  light: Object.freeze({ autoplay: false, trackers: true, images: false }),
  balanced: Object.freeze({ autoplay: true, trackers: true, images: false }),   // the default
  max: Object.freeze({ autoplay: true, trackers: true, images: true }),
});
export const LEVEL_NAMES = ['off', 'light', 'balanced', 'max'];
export const DEFAULT_LEVEL = 'balanced';

export function levelOf(settings) {
  if (!settings.saver) return 'off';
  for (const [name, level] of Object.entries(LEVELS)) {
    if (Object.entries(level).every(([saver, on]) => settings[saver] === on)) return name;
  }
  return 'custom';
}

// The settings patch for a level. Off pauses saving and keeps each saver's own value, so
// choosing a level again resumes.
export function applyLevel(name) {
  if (name === 'off') return { saver: false };
  if (!LEVELS[name]) throw new RangeError(`Unknown level: ${name}`);
  return { saver: true, ...LEVELS[name] };
}

// The site rule that applies to a host: the longest matching key wins.
export function overrideFor(settings, host) {
  if (!host) return null;
  let best = null;
  for (const key of Object.keys(settings.sites || {})) {
    if (hostMatches(host, key) && (!best || key.length > best.length)) best = key;
  }
  return best ? { host: best, overrides: settings.sites[best] } : null;
}

const isFullyAllowed = rules => SAVERS.every(saver => rules[saver] === false);

// What each saver does on a host, after its site rule.
export function effective(settings, host) {
  const rule = overrideFor(settings, host);
  if (!settings.saver) return { autoplay: false, trackers: false, images: false, fonts: false, saveData: false, overridden: !!rule };
  const result = {};
  for (const saver of SAVERS) {
    result[saver] = rule && typeof rule.overrides[saver] === 'boolean' ? rule.overrides[saver] : settings[saver];
  }
  result.saveData = settings.saveData && !(rule && isFullyAllowed(rule.overrides));
  result.overridden = !!rule;
  return result;
}

const sorted = list => [...list].sort();
const sitesWhere = (settings, test) => sorted(Object.entries(settings.sites || {}).filter(([, rules]) => test(rules)).map(([host]) => host));
const turnedOff = (settings, saver) => sitesWhere(settings, rules => rules[saver] === false);
const turnedOn = (settings, saver) => sitesWhere(settings, rules => rules[saver] === true);
const fullyAllowed = settings => sitesWhere(settings, isFullyAllowed);

// Every resource type both Firefox and Chrome accept. Without a list a rule skips main_frame.
const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'];

const block = (id, priority, condition) => ({ id, priority, action: { type: 'block' }, condition });
const unless = (key, list) => (list.length ? { [key]: list } : {});   // Chrome rejects empty lists

// The dynamic rules for the settings, sorted by id. Ids 1-99 are the savers':
// 1 trackers, 2 images, 3 fonts, 4 Save-Data (priority 1); 10 lets fully allowed sites load
// everything, iframes included (priority 4); 21-23 turn a globally-off saver on for some sites
// (priority 2). A site rule that turns a saver off is an excludedInitiatorDomains entry.
export function buildRules(settings) {
  if (!settings.saver) return [];
  const rules = [];
  const full = fullyAllowed(settings);
  const trackers = { requestDomains: TRACKER_HOSTS, domainType: 'thirdParty' };

  if (settings.trackers) rules.push(block(1, 1, { ...trackers, ...unless('excludedInitiatorDomains', turnedOff(settings, 'trackers')) }));
  if (settings.images) rules.push(block(2, 1, { resourceTypes: ['image'], ...unless('excludedInitiatorDomains', turnedOff(settings, 'images')) }));
  if (settings.fonts) rules.push(block(3, 1, { resourceTypes: ['font'], ...unless('excludedInitiatorDomains', turnedOff(settings, 'fonts')) }));
  if (settings.saveData) {
    rules.push({
      id: 4, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Save-Data', operation: 'set', value: 'on' }] },
      condition: { resourceTypes: ALL_TYPES, ...unless('excludedInitiatorDomains', full), ...unless('excludedRequestDomains', full) },
    });
  }
  if (full.length) {
    rules.push({ id: 10, priority: 4, action: { type: 'allowAllRequests' }, condition: { requestDomains: full, resourceTypes: ['main_frame', 'sub_frame'] } });
  }
  const trackersOn = turnedOn(settings, 'trackers');
  if (!settings.trackers && trackersOn.length) rules.push(block(21, 2, { ...trackers, initiatorDomains: trackersOn }));
  const imagesOn = turnedOn(settings, 'images');
  if (!settings.images && imagesOn.length) rules.push(block(22, 2, { resourceTypes: ['image'], initiatorDomains: imagesOn }));
  const fontsOn = turnedOn(settings, 'fonts');
  if (!settings.fonts && fontsOn.length) rules.push(block(23, 2, { resourceTypes: ['font'], initiatorDomains: fontsOn }));
  return rules.sort((a, b) => a.id - b.id);
}

// Match patterns for sites and their subdomains. IP addresses and hosts with ports have none.
export function patternsFor(hosts) {
  return hosts.flatMap(h => (/^[\d.]+$|:|^\[/.test(h) ? [`*://${h}/*`] : [`*://${h}/*`, `*://*.${h}/*`]));
}

export const YOUTUBE_MATCHES = ['*://youtube.com/*', '*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'];

// The content scripts for the settings (Chrome's `sizes` meter is added by the background).
// The YouTube limit is registered whenever it is set, whatever the savers and site rules say.
export function buildScripts(settings) {
  const scripts = [];
  const common = { allFrames: true, runAt: 'document_start', persistAcrossSessions: true };
  const pair = (suffix, where) => [
    { id: 'autoplay' + suffix, js: ['autoplay.js'], ...where, ...common },
    { id: 'autoplay-main' + suffix, js: ['autoplay-main.js'], ...where, world: 'MAIN', ...common },
  ];
  if (settings.saver && settings.autoplay) {
    scripts.push(...pair('', { matches: ['<all_urls>'], ...unless('excludeMatches', patternsFor(turnedOff(settings, 'autoplay'))) }));
  } else if (settings.saver && turnedOn(settings, 'autoplay').length) {
    scripts.push(...pair('-sites', { matches: patternsFor(turnedOn(settings, 'autoplay')) }));
  }
  if (settings.youtube !== 0) {
    scripts.push(
      { id: 'youtube-quality', js: ['youtube-quality.js'], matches: YOUTUBE_MATCHES, ...common },
      // The limit file sets the page's limit before YouTube's code runs (a storage read can't).
      { id: 'youtube-player', js: [`youtube/limit-${settings.youtube}.js`, 'youtube-player.js'], matches: YOUTUBE_MATCHES, world: 'MAIN', ...common },
    );
  }
  return scripts;
}

// The hosts of the frames a request belongs to: its own document (for a frame load), the
// document it was made from, and every ancestor frame.
function frameHosts(d) {
  const hosts = [];
  if (d.type === 'main_frame' || d.type === 'sub_frame') hosts.push(hostOf(d.url));
  hosts.push(hostOf(d.documentUrl));
  for (const frame of d.frameAncestors || []) hosts.push(hostOf(frame.url));
  return hosts.filter(Boolean);
}

// Which saver's rule blocks a request, mirroring buildRules(), or null. Used to count what
// Sip blocked, so blocks by other extensions aren't counted as Sip's.
export function wouldBlock(d, settings) {
  if (!settings.saver) return null;
  const host = hostOf(d.url);
  if (!host) return null;
  const full = fullyAllowed(settings);
  if (full.length && frameHosts(d).some(h => matchesAny(h, full))) return null;

  const initiator = hostOf(d.originUrl || d.initiator || d.documentUrl);
  const applies = saver => (settings[saver]
    ? !(initiator && matchesAny(initiator, turnedOff(settings, saver)))
    : !!initiator && matchesAny(initiator, turnedOn(settings, saver)));

  if (matchesAny(host, TRACKER_HOSTS) && isThirdParty(host, initiator) && applies('trackers')) return 'trackers';
  const type = d.type === 'imageset' ? 'image' : d.type;
  if (type === 'image' && applies('images')) return 'images';
  if (type === 'font' && applies('fonts')) return 'fonts';
  return null;
}

const YOUTUBE_HOSTS = ['youtube.com'];
export const isYoutubeHost = host => !!host && matchesAny(host, YOUTUBE_HOSTS);

// YouTube pages where the person chose a video, so it may play: /watch, /shorts/ and /live/.
// (A copy lives in autoplay-main.js, which can't import; tests/savers.test.js keeps them equal.)
// <watch-page>
export function isWatchPage(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return false;
    return u.pathname === '/watch' || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/');
  } catch {
    return false;
  }
}
// </watch-page>

// What an hour of YouTube costs at each limit, in bytes (low and high end; null = no top).
export const YT_COST = Object.freeze({
  240: [0.2e9, 0.2e9], 360: [0.3e9, 0.4e9], 480: [0.5e9, 0.7e9],
  720: [1e9, 1.5e9], 1080: [1.5e9, 3.3e9], 0: [3e9, null],
});
