// The popup: how much is left, today's share, this site's savers and YouTube quality, and the
// sites that used the most. It paints first from the stored summary, then from the background's
// view, and follows changes while it's open. Every change goes through the background.
import { MSG } from './lib/messages.js';
import { plural, t } from './lib/i18n.js';
import { formatCount, formatDate } from './lib/format.js';
import { localize } from './ui/i18n-dom.js';
import { $, $$, budget, drawMeter, el, fill, formatter, PACE_CLASS, radioKeys, send, setRadio, setSwitch, siteLabel, size, tile } from './ui/components.js';

const api = globalThis.browser ?? globalThis.chrome;
const MAX_HEIGHT = 520;
const SAVERS = ['trackers', 'autoplay', 'images', 'fonts'];

let view = null;
let tab = null;
let span = 'today';
let changedHere = false;    // a saver changed for this site since the popup opened: offer a reload
let ytNote = '';            // "Applied now" / "From the next video", after a change here

const b = text => el('b', {}, text);
const count = n => formatCount(n, formatter());
const date = key => formatDate(key, formatter());
const days = n => plural('sum_days', n, [count(n)]);

async function activeTab() {
  try {
    const id = Number(new URLSearchParams(location.search).get('tabId'));
    if (id) return await api.tabs.get(id);
    const [current] = await api.tabs.query({ active: true, currentWindow: true });
    return current ?? null;
  } catch {
    return null;
  }
}

function renderHero(summary, savingLevel) {
  const has = summary.hasBudget;
  const over = has && summary.left < 0;
  $('#renews').textContent = summary.text.renews + t('sum_join') + summary.text.days;
  const pill = $('#pace');
  pill.hidden = !summary.text.paceShort;
  pill.textContent = summary.text.paceShort;
  pill.className = `pill ${PACE_CLASS[summary.pace] ?? ''}`;

  const big = $('#big');
  big.textContent = size(has ? Math.abs(summary.left) : summary.used);
  big.classList.toggle('danger', over);
  if (!has) $('#of').textContent = t('popup_used_period');
  else fill($('#of'), over ? 'popup_over_of' : 'popup_left_of', [budget(summary.budget)]);

  $('#meter').hidden = !has;
  $('#scale').hidden = !has;
  if (has) {
    drawMeter($('#meter'), summary);
    fill($('#used'), 'popup_used', [size(summary.used)]);
    // The hatch's label: where this pace ends by renewal, or, when that's too far, the day it runs out.
    const projection = $('#projection');
    const fast = summary.pace === 'fast' && summary.runOut;
    if (fast) fill(projection, 'popup_runs_out', [date(summary.runOut), days(summary.daysEarly)]);
    else if (summary.projected !== null) fill(projection, 'popup_projection', [size(summary.projected), date(summary.renew)]);
    else projection.replaceChildren();
    projection.title = fast ? summary.text.pace : summary.text.projection;
    projection.classList.toggle('warn', !!fast);
  }

  const value = $('#today');
  const mini = $('#today-mini');
  mini.hidden = !has || summary.overToday > 0;
  value.classList.toggle('warn', summary.overToday > 0);
  mini.classList.toggle('warn', summary.overToday > 0);
  if (!has) value.replaceChildren(b(size(summary.today)));
  else if (summary.overToday > 0) value.replaceChildren(b(size(summary.today)), t('sum_join'), summary.text.over);
  else fill(value, 'popup_today_share', [b(size(summary.today)), size(summary.share)]);
  mini.firstElementChild.style.width = `${summary.share ? Math.min(100, (summary.today / summary.share) * 100) : 100}%`;

  $('#tip-over').hidden = summary.level !== 'over';
  $('#tip-max').hidden = !has || summary.level === 'over' || !(summary.pace === 'fast' || summary.overToday > 0) || savingLevel === 'max' || savingLevel === null;
  $('#set-budget').hidden = has;
}

function renderLevel() {
  const level = view.savingLevel;
  setRadio($('#level'), 'level', level);
  $('#custom').hidden = level !== 'custom';
}

function renderSite() {
  const site = view.site;
  $('#site').hidden = !site;
  if (!site) return;
  const { settings } = view;
  const paused = !settings.saver;
  $('#site-tile').replaceChildren(tile(site.host));
  $('#site-host').textContent = site.host;
  if (site.private) $('#site-use').replaceChildren();
  else fill($('#site-use'), 'popup_site_use', [b(size(site.today)), size(site.period)]);
  $('#site-private').hidden = !site.private;

  $('#yt').hidden = !site.isYoutube;
  if (site.isYoutube) {
    setRadio($('#yt-choices'), 'q', settings.youtube);
    $('#yt-cost').textContent = t(`yt_cost_${settings.youtube}`);
    $('#yt-applied').textContent = ytNote;
    $('#yt-applied').hidden = !ytNote;
  }
  const savers = $('#site-savers');
  savers.classList.toggle('collapsible', site.isYoutube);
  if (!site.isYoutube) savers.open = true;
  for (const chip of $$('.chip')) {
    const saver = chip.dataset.saver;
    setSwitch(chip, site.effective[saver], paused);
    chip.classList.toggle('rule', !!site.overrides && saver in site.overrides);
  }
  $('#site-actions').hidden = !site.overridden && !changedHere;
  $('#site-rule').hidden = !site.overridden;
  $('#site-reset').hidden = !site.overridden || paused;
  $('#site-reload').hidden = !changedHere;
}

function renderSites() {
  const list = $('#site-list');
  const rows = (span === 'today' ? view.todaySites : view.periodSites).slice(0, view.site?.isYoutube ? 2 : 5);
  const top = rows[0]?.[1] || 1;
  list.replaceChildren(...rows.map(([site, bytes]) => el('li', { class: site === view.site?.host ? 'cur' : '' },
    tile(site),
    el('span', { class: 'h' }, el('bdi', {}, siteLabel(site))),
    el('span', { class: 'share', 'aria-hidden': 'true' }, el('i', { style: `width:${(bytes / top) * 100}%` })),
    el('span', { class: 'v num' }, size(bytes)))));
  $('#no-sites').hidden = rows.length > 0;
  for (const button of $$('#span button')) button.setAttribute('aria-pressed', String(button.dataset.span === span));
}

// What Sip saved, the estimate first: "≈ 420 MB saved · 1,204 blocked · 38 videos stopped".
function renderSaved(saved) {
  const parts = [];
  if (saved.est) parts.push(b(t('sum_saved_est', [size(saved.est)])));
  if (saved.req) parts.push(plural('popup_blocked', saved.req, [count(saved.req)]));
  if (saved.media) parts.push(plural('sum_saved_media', saved.media, [count(saved.media)]));
  const line = $('#saved');
  line.hidden = !parts.length;
  line.replaceChildren(...parts.flatMap((part, i) => (i ? [t('sum_join'), part] : [part])));
  line.title = line.textContent;
}

function render() {
  const { summary } = view;
  renderLevel();
  renderHero(summary, view.savingLevel);
  renderSite();
  renderSites();
  $('#hint-access').hidden = view.hostAccess;
  $('#hint-setup').hidden = !view.firstRun;
  $('#hint-private').hidden = view.privateAllowed;
  renderSaved(summary.saved);
  $('#yt-line').textContent = summary.text.youtube;
  $('#yt-row').hidden = !!view.site?.isYoutube;   // the switcher above already shows it
  fit();
}

// Firefox cuts popups off at 600 px; Sip keeps to 520 by showing fewer sites, then fewer hints.
function fit() {
  const list = $('#site-list');
  const tall = () => document.body.scrollHeight > MAX_HEIGHT;
  const keep = view.site?.isYoutube ? 2 : 3;
  while (tall() && list.children.length > keep) list.lastElementChild.remove();
  if (tall()) $('#hint-private').hidden = true;
  while (tall() && list.children.length > 1) list.lastElementChild.remove();
}

async function refresh() {
  const reply = await send({ type: MSG.VIEW, tabUrl: tab?.url, tabIncognito: tab?.incognito });
  if (!reply?.ok) return;
  view = reply.view;
  render();
}

async function act(message) {
  const reply = await send(message);
  await refresh();
  return reply;
}

function openPage(path) {
  api.tabs.create({ url: api.runtime.getURL(path) });
  window.close();
}

// A button that does something hard to undo asks for a second click.
function confirmTwice(button, run) {
  button.addEventListener('click', async () => {
    if (!button.dataset.armed) {
      button.dataset.armed = button.textContent;
      button.textContent = t('popup_confirm_again');
      setTimeout(() => {
        if (button.dataset.armed) button.textContent = button.dataset.armed;
        delete button.dataset.armed;
      }, 4000);
      return;
    }
    button.textContent = button.dataset.armed;
    delete button.dataset.armed;
    await run();
  });
}

function wire() {
  for (const radio of $$('#level [role="radio"]')) {
    radio.addEventListener('click', () => act({ type: MSG.LEVEL_SET, level: radio.dataset.level }));
  }
  radioKeys($('#level'));
  $('#use-max').addEventListener('click', () => act({ type: MSG.LEVEL_SET, level: 'max' }));
  confirmTwice($('#renewed'), () => act({ type: MSG.RENEW_TODAY }));
  $('#set-budget').addEventListener('click', () => openPage('options.html#plan'));
  $('#setup').addEventListener('click', () => openPage('options.html?first=1'));
  $('#grant').addEventListener('click', async () => {
    await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    await refresh();
  });
  for (const chip of $$('.chip')) {
    chip.addEventListener('click', () => {
      const site = view?.site;
      if (!site || !view.settings.saver) return;
      const saver = chip.dataset.saver;
      changedHere = true;
      act({ type: MSG.SITE_SET, host: site.overrideHost ?? site.host, overrides: { ...(site.overrides ?? {}), [saver]: !site.effective[saver] } });
    });
  }
  $('#site-reset').addEventListener('click', () => {
    changedHere = true;
    act({ type: MSG.SITE_SET, host: view.site.overrideHost, overrides: null });
  });
  $('#site-reload').addEventListener('click', () => {
    if (tab?.id !== undefined) api.tabs.reload(tab.id);
    changedHere = false;
    renderSite();
  });
  for (const choice of $$('#yt-choices [role="radio"]')) {
    choice.addEventListener('click', () => {
      const next = Number(choice.dataset.q);
      const before = view.settings.youtube;
      if (next === before) return;
      const lower = next !== 0 && (before === 0 || next < before);
      ytNote = t(lower ? 'yt_applied_now' : 'yt_from_next');
      act({ type: MSG.SETTINGS_SET, patch: { youtube: next } });
    });
  }
  radioKeys($('#yt-choices'));
  for (const button of $$('#span button')) {
    button.addEventListener('click', () => {
      span = button.dataset.span;
      renderSites();
      fit();
    });
  }
  $('#yt-change').addEventListener('click', () => openPage('options.html#youtube'));
  $('#private-how').addEventListener('click', () => openPage('options.html#private'));
  $('#settings').addEventListener('click', () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  let pending = null;
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some(key => key === 'summary' || key.startsWith('opt.'))) return;
    clearTimeout(pending);
    pending = setTimeout(refresh, 150);
  });
}

async function start() {
  await localize();
  wire();
  const { summary } = await api.storage.local.get('summary');
  if (summary) renderHero(summary, null);
  tab = await activeTab();
  await refresh();
}

start();
