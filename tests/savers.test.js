import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, loadSettings } from '../lib/settings.js';
import { applyLevel, buildRules, buildScripts, effective, isWatchPage, levelOf, overrideFor, wouldBlock } from '../lib/savers.js';
import { TRACKER_HOSTS } from '../lib/trackers.js';

const settings = patch => ({ ...loadSettings({}), ...patch });
const ids = rules => rules.map(r => r.id);

test('levels are three savers; fonts, Save-Data, YouTube and site rules are never part of them', () => {
  assert.equal(levelOf(settings({})), 'balanced');
  assert.equal(levelOf(settings({ fonts: true, saveData: true, youtube: 240 })), 'balanced');
  assert.equal(levelOf(settings({ autoplay: false })), 'light');
  assert.equal(levelOf(settings({ images: true })), 'max');
  assert.equal(levelOf(settings({ trackers: false })), 'custom');
  assert.equal(levelOf(settings({ saver: false })), 'off');
  assert.deepEqual(applyLevel('off'), { saver: false });
  for (const level of ['light', 'balanced', 'max', 'off']) {
    const patch = applyLevel(level);
    for (const key of ['youtube', 'fonts', 'saveData', 'sites']) assert.ok(!(key in patch), `${level} touches ${key}`);
  }
  assert.throws(() => applyLevel('turbo'), RangeError);
});

test('the default rules: trackers only, third party', () => {
  const rules = buildRules(settings({}));
  assert.deepEqual(ids(rules), [1]);
  assert.equal(rules[0].condition.domainType, 'thirdParty');
  assert.deepEqual(rules[0].condition.requestDomains, TRACKER_HOSTS);
  assert.equal('excludedInitiatorDomains' in rules[0].condition, false, 'no empty lists (Chrome rejects them)');
});

test('paused saving has no rules', () => {
  assert.deepEqual(buildRules(settings({ saver: false, images: true, saveData: true })), []);
});

test('a site rule that turns a saver off excludes that site', () => {
  const rules = buildRules(settings({ images: true, sites: { 'shop.test': { images: false } } }));
  assert.deepEqual(ids(rules), [1, 2]);
  assert.deepEqual(rules[1].condition.excludedInitiatorDomains, ['shop.test']);
});

test('a site rule that turns a saver on blocks it there only', () => {
  const rules = buildRules(settings({ trackers: false, sites: { 'manga.test': { images: true }, 'news.test': { trackers: true, fonts: true } } }));
  assert.deepEqual(ids(rules), [21, 22, 23]);
  assert.deepEqual(rules.find(r => r.id === 22).condition, { resourceTypes: ['image'], initiatorDomains: ['manga.test'] });
  assert.equal(rules.find(r => r.id === 21).priority, 2);
});

test('fully allowed sites get everything, iframes included, and no Save-Data', () => {
  const all = { autoplay: false, trackers: false, images: false, fonts: false };
  const rules = buildRules(settings({ saveData: true, sites: { 'a.test': all } }));
  assert.deepEqual(ids(rules), [1, 4, 10]);
  assert.deepEqual(rules.find(r => r.id === 10), { id: 10, priority: 4, action: { type: 'allowAllRequests' },
    condition: { requestDomains: ['a.test'], resourceTypes: ['main_frame', 'sub_frame'] } });
  assert.deepEqual(rules.find(r => r.id === 4).condition.excludedRequestDomains, ['a.test']);
  assert.ok(rules.find(r => r.id === 4).condition.resourceTypes.includes('main_frame'));
});

test('the longest matching site rule wins', () => {
  const s = settings({ sites: { 'reddit.com': { images: true }, 'old.reddit.com': { images: false } } });
  assert.equal(overrideFor(s, 'm.reddit.com').host, 'reddit.com');
  assert.equal(overrideFor(s, 'x.old.reddit.com').host, 'old.reddit.com');
  assert.equal(overrideFor(s, 'notreddit.com'), null);
  assert.equal(effective(s, 'old.reddit.com').images, false);
  assert.equal(effective(s, 'm.reddit.com').images, true);
  assert.deepEqual(effective(settings({ saver: false }), 'a.com'), { autoplay: false, trackers: false, images: false, fonts: false, saveData: false, overridden: false });
});

test('scripts: autoplay where the saver is on, YouTube whatever the savers say', () => {
  const names = s => buildScripts(s).map(x => x.id);
  assert.deepEqual(names(settings({})), ['autoplay', 'autoplay-main', 'youtube-quality', 'youtube-player']);
  assert.deepEqual(names(settings({ saver: false })), ['youtube-quality', 'youtube-player']);
  assert.deepEqual(names(settings({ youtube: 0 })), ['autoplay', 'autoplay-main']);
  assert.deepEqual(names(settings({ autoplay: false, sites: { 'v.test': { autoplay: true } } })),
    ['autoplay-sites', 'autoplay-main-sites', 'youtube-quality', 'youtube-player']);
  const off = buildScripts(settings({ sites: { 'tube.test': { autoplay: false }, '10.0.0.2': { autoplay: false } } }));
  assert.deepEqual(off[0].excludeMatches, ['*://10.0.0.2/*', '*://tube.test/*', '*://*.tube.test/*']);
  const yt = buildScripts(settings({ youtube: 720 })).find(x => x.id === 'youtube-player');
  assert.deepEqual(yt.js, ['youtube/limit-720.js', 'youtube-player.js']);
  assert.equal(yt.world, 'MAIN');
  assert.ok(yt.matches.includes('*://*.youtube-nocookie.com/*'));
  for (const script of buildScripts(settings({}))) {
    assert.equal(script.runAt, 'document_start');
    assert.equal(script.allFrames, true);
    assert.equal(script.persistAcrossSessions, true);
  }
});

test('every YouTube choice has its limit file', () => {
  for (const n of [240, 360, 480, 720, 1080]) assert.match(readFileSync(new URL(`../youtube/limit-${n}.js`, import.meta.url), 'utf8'), new RegExp(`"${n}"`));
});

// Forty sample requests: wouldBlock must agree with what the rules say.
test('wouldBlock mirrors the rules', () => {
  const page = host => `https://${host}/page`;
  const all = { autoplay: false, trackers: false, images: false, fonts: false };
  const cases = [];
  const configs = [
    [settings({}), { tracker: 'trackers', image: null, font: null }],
    [settings({ images: true, fonts: true }), { tracker: 'trackers', image: 'images', font: 'fonts' }],
    [settings({ saver: false, images: true }), { tracker: null, image: null, font: null }],
    [settings({ trackers: false }), { tracker: null, image: null, font: null }],
  ];
  for (const [s, want] of configs) {
    for (const site of ['news.com', 'blog.org']) {
      cases.push([s, { type: 'script', url: 'https://www.google-analytics.com/a.js', originUrl: page(site), documentUrl: page(site) }, want.tracker]);
      cases.push([s, { type: 'image', url: `https://${site}/a.jpg`, originUrl: page(site), documentUrl: page(site) }, want.image]);
      cases.push([s, { type: 'imageset', url: `https://cdn.x.com/a.jpg`, originUrl: page(site), documentUrl: page(site) }, want.image]);
      cases.push([s, { type: 'font', url: `https://fonts.x.com/a.woff2`, originUrl: page(site), documentUrl: page(site) }, want.font]);
      cases.push([s, { type: 'script', url: `https://${site}/app.js`, originUrl: page(site), documentUrl: page(site) }, null]);
    }
  }
  const allowed = settings({ images: true, sites: { 'shop.test': { images: false }, 'free.test': all, 'manga.test': { trackers: false } } });
  cases.push([allowed, { type: 'image', url: 'https://shop.test/a.jpg', originUrl: page('shop.test') }, null]);
  cases.push([allowed, { type: 'image', url: 'https://cdn.test/a.jpg', originUrl: page('m.shop.test') }, null]);
  cases.push([allowed, { type: 'image', url: 'https://other.test/a.jpg', originUrl: page('other.test') }, 'images']);
  cases.push([allowed, { type: 'image', url: 'https://b.test/a.jpg', originUrl: page('b.test'), documentUrl: page('b.test'), frameAncestors: [{ url: page('free.test') }] }, null]);
  cases.push([allowed, { type: 'sub_frame', url: page('free.test') }, null]);
  cases.push([allowed, { type: 'script', url: 'https://doubleclick.net/x.js', originUrl: page('manga.test') }, null]);
  cases.push([allowed, { type: 'script', url: 'https://doubleclick.net/x.js', originUrl: page('other.test') }, 'trackers']);
  cases.push([allowed, { type: 'script', url: 'https://analytics.google.com/app.js', originUrl: page('analytics.google.com') }, null]); // first party
  const on = settings({ trackers: false, images: false, sites: { 'manga.test': { images: true }, 'n.test': { trackers: true } } });
  cases.push([on, { type: 'image', url: 'https://cdn.test/p.jpg', originUrl: page('manga.test') }, 'images']);
  cases.push([on, { type: 'image', url: 'https://cdn.test/p.jpg', originUrl: page('other.test') }, null]);
  cases.push([on, { type: 'script', url: 'https://hotjar.com/h.js', originUrl: page('n.test') }, 'trackers']);
  assert.ok(cases.length >= 40, `${cases.length} cases`);
  for (const [s, d, want] of cases) assert.equal(wouldBlock(d, s), want, JSON.stringify(d));
});

test('YouTube watch, Shorts and live pages may play', () => {
  assert.ok(isWatchPage('https://www.youtube.com/watch?v=abc'));
  assert.ok(isWatchPage('https://m.youtube.com/shorts/abc'));
  assert.ok(isWatchPage('https://www.youtube.com/live/abc'));
  assert.ok(!isWatchPage('https://www.youtube.com/'));
  assert.ok(!isWatchPage('https://www.youtube-nocookie.com/embed/abc'));
  assert.ok(!isWatchPage('https://notyoutube.com/watch'));
});

// Content scripts can't import, so they carry copies; these must stay the same code.
test('the content scripts\' copies match lib/', () => {
  const block = (file, tag) => {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    const match = text.match(new RegExp(`// <${tag}>\\n([\\s\\S]*?)// </${tag}>`));
    assert.ok(match, `${file} has no ${tag} block`);
    return match[1].split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//')).join('\n')
      .replace(/^export /gm, '');
  };
  for (const file of ['../autoplay.js', '../autoplay-main.js']) {
    assert.equal(block(file, 'watch-page'), block('../lib/savers.js', 'watch-page'), file);
    assert.equal(block(file, 'gesture'), block('../lib/gesture.js', 'gesture'), file);
  }
});

test('the defaults are what the specification says', () => {
  assert.deepEqual(DEFAULTS, {
    saver: true, autoplay: true, trackers: true, images: false, fonts: false, saveData: false, youtube: 480,
    sites: {}, budgetGB: 0, period: { kind: 'monthly', day: 1 }, overhead: 5, notify: true, notifyPace: true,
    lang: 'auto', debug: false, firstRunDone: false,
  });
});
