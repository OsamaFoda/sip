import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKERS, TRACKER_HOSTS } from '../lib/trackers.js';
import { hostMatches } from '../lib/meter.js';

// Hosts pages need to work: sign-in, CAPTCHAs, payments, consent dialogs, maps, fonts, code, video.
const NEEDED = ['accounts.google.com', 'apis.google.com', 'www.google.com', 'gstatic.com', 'fonts.gstatic.com',
  'recaptcha.net', 'hcaptcha.com', 'challenges.cloudflare.com', 'js.stripe.com', 'stripe.network', 'm.stripe.com',
  'paypal.com', 'paypalobjects.com', 'braintreegateway.com', 'cdn.cookielaw.org', 'onetrust.com', 'cookiebot.com',
  'consensu.org', 'privacy-mgmt.com', 'didomi.io', 'usercentrics.eu', 'trustarc.com', 'fundingchoicesmessages.google.com',
  'maps.googleapis.com', 'ajax.googleapis.com', 'fonts.googleapis.com', 'youtube.com', 'ytimg.com', 'googlevideo.com',
  'youtube-nocookie.com', 'cdnjs.cloudflare.com', 'jsdelivr.net', 'unpkg.com', 'appleid.cdn-apple.com', 'www.facebook.com',
  'fbcdn.net', 'twimg.com', 'platform.twitter.com', 'disqus.com', 'i0.wp.com', 'cloudfront.net', 'amazonaws.com',
  'akamaihd.net', 'sentry.io', 'cdn.optimizely.com'];

test('the tracker list is a few hundred valid, lowercase hosts with kinds', () => {
  assert.ok(TRACKER_HOSTS.length >= 150, `${TRACKER_HOSTS.length} hosts`);
  assert.equal(new Set(TRACKER_HOSTS).size, TRACKER_HOSTS.length, 'duplicates');
  for (const { host, kind } of TRACKERS) {
    assert.match(host, /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/, host);
    assert.ok(['ads', 'analytics', 'social', 'session-replay', 'consent', 'video-ads'].includes(kind), kind);
  }
});

test('no host is a subdomain of another listed host', () => {
  for (const a of TRACKER_HOSTS) for (const b of TRACKER_HOSTS) if (a !== b) assert.ok(!hostMatches(a, b), `${a} is under ${b}`);
});

test('nothing a page needs to work is on the list', () => {
  for (const host of TRACKER_HOSTS) {
    for (const needed of NEEDED) assert.ok(!hostMatches(needed, host) && !hostMatches(host, needed), `${host} would block ${needed}`);
  }
  assert.ok(TRACKER_HOSTS.includes('connect.facebook.net'));
});
