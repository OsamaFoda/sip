import test from 'node:test';
import assert from 'node:assert/strict';
import { baseDomain, exactBytes, hostOf, isThirdParty, kindOf, responseBytes, siteOf } from '../lib/meter.js';

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
  assert.deepEqual(responseBytes({ fromCache: true, responseHeaders: headers({ 'content-length': '9000' }) }), { bytes: 0, headerBytes: 0, known: true });
  const r = responseBytes({ statusCode: 304, responseHeaders: headers({ ETag: 'x' }) });
  assert.equal(r.known, true);
  assert.ok(r.bytes < 100);
});

test('exactBytes uses what Firefox counted, sent and received', () => {
  assert.equal(exactBytes({ responseSize: 5300, requestSize: 420, statusCode: 200 }), 5720);
  assert.equal(exactBytes({ responseSize: 350143, requestSize: 400 }), 350543); // stopped partway
  assert.equal(exactBytes({ responseSize: 0, requestSize: 0, fromCache: true, statusCode: 200 }), 0);
  assert.equal(exactBytes({ responseSize: 0, requestSize: 300, statusCode: 304 }), 300);
});

test('exactBytes falls back where the browser gives no size, or a suspicious zero', () => {
  assert.equal(exactBytes({ statusCode: 200 }), null);                    // Chrome
  assert.equal(exactBytes({ responseSize: 0, statusCode: 200 }), null);   // Firefox bug 1810344
});

test('hostOf strips www and ignores non-web URLs', () => {
  assert.equal(hostOf('https://www.youtube.com/watch?v=1'), 'youtube.com');
  assert.equal(hostOf('moz-extension://abc/popup.html'), '');
  assert.equal(hostOf('about:blank'), '');
  assert.equal(hostOf('not a url'), '');
});

test('requests are credited to the page they were made for', () => {
  const page = 'https://www.news.com/story';
  assert.equal(siteOf({ type: 'main_frame', url: page }), 'news.com');
  assert.equal(siteOf({ type: 'main_frame', url: 'https://cdn.dl.com/file.zip', documentUrl: page }), 'cdn.dl.com'); // a 204 or download
  assert.equal(siteOf({ type: 'image', url: 'https://img.cdn.com/a.jpg', documentUrl: page }), 'news.com');
  assert.equal(siteOf({ type: 'script', url: 'https://ads.x.com/a.js', documentUrl: 'https://ads.x.com/frame',
    frameAncestors: [{ url: 'https://ads.x.com/outer' }, { url: page }] }), 'news.com');
  assert.equal(siteOf({ type: 'xmlhttprequest', url: 'https://list.org/a.txt', originUrl: 'moz-extension://abc/background.html' }), '#extensions');
  assert.equal(siteOf({ type: 'image', url: 'https://a.com/x.png', documentUrl: page, incognito: true }), '#private');
  assert.equal(siteOf({ type: 'image', url: 'https://a.com/x.png', documentUrl: 'about:blank', originUrl: 'https://shop.com/' }), 'shop.com');
  assert.equal(siteOf({ type: 'other', url: 'https://a.com/x' }), '#other');
  assert.equal(siteOf({ type: 'other', url: 'https://a.com/x' }, 'tab.com'), 'tab.com');
});

test('trackers, images and fonts are told apart for the saved estimate', () => {
  assert.equal(kindOf({ type: 'image', url: 'https://www.google-analytics.com/collect', originUrl: 'https://news.com/' }), 'tracker');
  assert.equal(kindOf({ type: 'image', url: 'https://news.com/a.jpg', originUrl: 'https://news.com/' }), 'image');
  assert.equal(kindOf({ type: 'font', url: 'https://fonts.cdn.com/a.woff2', originUrl: 'https://news.com/' }), 'font');
  assert.equal(kindOf({ type: 'script', url: 'https://news.com/a.js', originUrl: 'https://news.com/' }), null);
});

test('third parties are judged by the registrable domain', () => {
  assert.equal(baseDomain('a.b.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(baseDomain('www.masrawy.com.eg'), 'masrawy.com.eg');
  assert.equal(baseDomain('static.cdn.example.com'), 'example.com');
  assert.equal(isThirdParty('connect.facebook.net', 'facebook.com'), true);
  assert.equal(isThirdParty('img.bbc.co.uk', 'www.bbc.co.uk'), false);
});
