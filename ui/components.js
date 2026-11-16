// Small pieces the popup, settings and first run share. Pure DOM, no framework.
import { formatBudget, formatBytes, makeFormatter } from '../lib/format.js';
import { t, uiLocale } from '../lib/i18n.js';

const api = globalThis.browser ?? globalThis.chrome;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Builds an element: el('button', { class: 'btn', onclick }, 'text', child…).
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return node;
}

// A value or host name kept in its own direction inside Arabic text.
export const bdi = text => el('bdi', {}, String(text));

let fmt = null;
export function formatter() {
  if (!fmt || fmt.lang !== uiLocale()) fmt = makeFormatter(uiLocale(), t);
  return fmt;
}
export const size = n => formatBytes(n, formatter());
export const budget = n => formatBudget(n, formatter());

// Fills an element with a message whose $1…$9 are elements or text (each figure in its own <bdi>),
// so the sentence's word order stays the translator's.
export function fill(node, key, parts = []) {
  const marker = '\u0000';
  const text = t(key, parts.map((_, i) => `${marker}${i}${marker}`));
  node.replaceChildren(...text.split(marker).map((piece, i) => {
    if (i % 2 === 0) return piece;
    const part = parts[Number(piece)];
    return part instanceof Node ? part : bdi(part);
  }));
  return node;
}

const BUCKETS = { '#private': 'bucket_private', '#extensions': 'bucket_extensions', '#other': 'bucket_other' };
export const siteLabel = site => (BUCKETS[site] ? t(BUCKETS[site]) : site);

// A site's tile: its first letter on a colour of its own (Sip never fetches favicons, which cost data).
export function tile(site) {
  if (BUCKETS[site]) return el('span', { class: 'fav bucket', 'aria-hidden': 'true' }, site === '#private' ? '●' : '·');
  if (/(^|\.)youtube\.com$/.test(site)) return el('span', { class: 'fav yt', 'aria-hidden': 'true' });
  let hash = 0;
  for (const c of site) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const node = el('span', { class: 'fav', 'aria-hidden': 'true' }, site.replace(/^(www|m)\./, '')[0] || '?');
  node.style.background = `hsl(${hash % 360} 50% 30%)`;   // dark enough for white letters in every hue
  return node;
}

export function setSwitch(node, on, disabled = false) {
  node.setAttribute('aria-checked', String(!!on));
  node.setAttribute('aria-disabled', String(!!disabled));
}

// Marks the chosen radio in a role=radiogroup by its data attribute.
export function setRadio(group, attr, value) {
  for (const button of $$('[role="radio"]', group)) {
    const on = button.dataset[attr] === String(value);
    button.setAttribute('aria-checked', String(on));
    button.tabIndex = on ? 0 : -1;
  }
}

// Arrow keys move between radios, as a radio group should (mirrored in right-to-left).
export function radioKeys(group) {
  group.addEventListener('keydown', event => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    const radios = $$('[role="radio"]:not([aria-disabled="true"])', group);
    const rtl = getComputedStyle(group).direction === 'rtl';
    let step = keys[event.key];
    if (rtl && event.key.startsWith('Arrow') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) step = -step;
    const index = radios.indexOf(document.activeElement);
    const next = radios[(index + step + radios.length) % radios.length];
    next.focus();
    next.click();
    event.preventDefault();
  });
}

// The bar on every surface: the filled part is what's used, the hatched part where this pace
// ends by renewal.
export function drawMeter(meter, summary) {
  const used = Math.min(1, Math.max(0, summary.ratio));
  const proj = summary.projRatio === null ? used : Math.min(1, Math.max(used, summary.projRatio));
  meter.querySelector('.used').style.width = `${used * 100}%`;
  const hatch = meter.querySelector('.proj');
  hatch.style.insetInlineStart = `${used * 100}%`;
  hatch.style.width = `${(proj - used) * 100}%`;
  meter.classList.toggle('warn', summary.pace === 'fast' || summary.level === 'danger');
  meter.classList.toggle('danger', summary.level === 'over');
  meter.setAttribute('aria-valuenow', String(Math.round(Math.min(1, summary.ratio) * 1000) / 10));
  meter.setAttribute('aria-valuetext', summary.text.left.replace(/[⁨⁩]/g, ''));
}

export const PACE_CLASS = { ok: '', fast: 'warn', over: 'danger' };

export async function send(message) {
  try {
    return await api.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
