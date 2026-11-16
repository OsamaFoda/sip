// How Sip measures a request and decides which site it belongs to.

import { TRACKER_HOSTS } from './trackers.js';

// What Firefox reports in webRequest.onErrorOccurred when a declarativeNetRequest rule blocked a
// request (probed in Astrelle 153 by tools/e2e/case_probe_dnr.py). It is the generic abort, so a
// request counts as saved only when Sip's own rules match it and nothing arrived. (The same probe
// found that onBeforeRedirect reports no sizes, so redirect hops are counted by their headers.)
export const DNR_BLOCK_ERROR = 'NS_ERROR_ABORT';

// Hostname without a leading "www.", or '' for anything that isn't a web address.
export function hostOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// True when host is domain itself or one of its subdomains.
export const hostMatches = (host, domain) => host === domain || host.endsWith('.' + domain);
export const matchesAny = (host, domains) => domains.some(d => hostMatches(host, d));

// Second-level names under which a site's own name is the third label (bbc.co.uk, masrawy.com.eg).
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil', 'sch', 'nic']);

// The registrable part of a host, closely enough for telling one site from another.
export function baseDomain(host) {
  if (!host || /^[\d.]+$/.test(host) || host.startsWith('[')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const [second, top] = labels.slice(-2);
  const keep = top.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export const isThirdParty = (host, initiatorHost) => !initiatorHost || baseDomain(host) !== baseDomain(initiatorHost);

const isExtension = url => typeof url === 'string' && /^(moz|chrome)-extension:/.test(url);

// The site a request is credited to: the page it was made for, not the server that answered.
// `fallback` is the tab's site, which only the Chrome path keeps.
export function siteOf(d, fallback) {
  if (d.incognito) return '#private';
  if (isExtension(d.originUrl) || isExtension(d.documentUrl) || isExtension(d.initiator)) return '#extensions';
  if (d.type === 'main_frame') {
    const host = hostOf(d.url);
    if (host) return host;
  }
  const ancestors = d.frameAncestors;
  if (ancestors?.length) {
    const host = hostOf(ancestors[ancestors.length - 1].url);
    if (host) return host;
  }
  const doc = hostOf(d.documentUrl);
  if (doc) return doc;
  if (fallback) return fallback;
  return hostOf(d.originUrl || d.initiator) || '#other';
}

// Which running average a finished response feeds: what Sip would have saved by blocking it.
export function kindOf(d) {
  const host = hostOf(d.url);
  if (host && matchesAny(host, TRACKER_HOSTS) && isThirdParty(host, hostOf(d.originUrl || d.initiator || d.documentUrl))) {
    return 'tracker';
  }
  if (d.type === 'image' || d.type === 'imageset') return 'image';
  if (d.type === 'font') return 'font';
  return null;
}

// Bytes a finished request cost, from its webRequest details (the Chrome path).
// Headers are estimated from their text; the body comes from Content-Length.
// `known` is false when the server sent no length (usually streamed HTML or JSON),
// in which case the content script's timing data may fill in the body later.
export function responseBytes(details) {
  let headerBytes = (details.statusLine || '').length + 2;
  let body = null;
  for (const h of details.responseHeaders || []) {
    headerBytes += h.name.length + (h.value || '').length + 4;
    if (h.name.toLowerCase() === 'content-length') {
      const n = parseInt(h.value, 10);
      if (n >= 0) body = n;
    }
  }
  if (details.fromCache) return { bytes: 0, headerBytes: 0, known: true };
  if (details.statusCode === 204 || details.statusCode === 304 || details.method === 'HEAD') body = 0;
  return { bytes: headerBytes + (body ?? 0), headerBytes, known: body !== null };
}

// What Firefox itself counted for a request: everything received and sent, headers included,
// and what arrived before a transfer was stopped. null where the browser doesn't say (Chrome),
// or says 0 for a response that wasn't cached (Firefox bug 1810344), so the estimate is used.
export function exactBytes(details) {
  if (typeof details.responseSize !== 'number') return null;
  if (!details.responseSize && !details.fromCache && details.statusCode !== 204 && details.statusCode !== 304) return null;
  return details.responseSize + (details.requestSize || 0);
}
