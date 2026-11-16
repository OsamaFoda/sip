// Sip's settings, and the first-run setup (options.html?first=1). Every change goes through the
// background, which validates it; the page shows the stored value back and follows changes made
// elsewhere (the popup, Astrelle), without touching a field while it's being edited.
import { MSG } from './lib/messages.js';
import { plural, t } from './lib/i18n.js';
import { formatSigned, isolate } from './lib/format.js';
import { applyLevel } from './lib/savers.js';
import { normalizeHost, YOUTUBE_CHOICES } from './lib/settings.js';
import { dayKey } from './lib/store.js';
import { localize } from './ui/i18n-dom.js';
import { $, $$, budget, el, fill, formatter, radioKeys, send, setRadio, setSwitch, size } from './ui/components.js';

const api = globalThis.browser ?? globalThis.chrome;
const SAVERS = ['autoplay', 'trackers', 'images', 'fonts', 'saveData'];
const RULE_SAVERS = ['trackers', 'autoplay', 'images', 'fonts'];
const LEVELS = ['light', 'balanced', 'max'];
const LEVEL_PARTS = {
  light: { saves: ['saver_trackers_name'], breaks: 'level_light_breaks' },
  balanced: { saves: ['level_everything_light', 'saver_autoplay_name'], breaks: 'level_balanced_breaks' },
  max: { saves: ['level_everything_balanced', 'saver_images_name'], breaks: 'level_max_breaks' },
};
const ADD_PRESETS = {
  all: { autoplay: false, trackers: false, images: false, fonts: false },
  images: { images: false },
  autoplay: { autoplay: false },
  'block-images': { images: true },
};

let view = null;
const first = new URLSearchParams(location.search).get('first') === '1';

// A field the person is typing in keeps what they typed until they're done.
function show(input, value) {
  if (document.activeElement === input && input.dataset.dirty) return;
  input.value = value;
  delete input.dataset.dirty;
}
const gbText = gb => (gb ? new Intl.NumberFormat(formatter().locale, { maximumFractionDigits: 2, useGrouping: false }).format(gb) : '');
const toBytes = text => {
  const n = Number(String(text).trim().replace(/[٠-٩]/g, c => c.charCodeAt(0) - 0x660).replace(/[٫,]/g, '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e9) : null;
};

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

async function act(message) {
  const reply = await send(message);
  await refresh();
  return reply;
}
const set = patch => act({ type: MSG.SETTINGS_SET, patch });

// ----- Building the parts that repeat -----------------------------------------------------------

function ytChoices(group, withCost) {
  group.replaceChildren(...YOUTUBE_CHOICES.map(q => el('button', { role: 'radio', dataset: { q: String(q) } },
    el('span', {}, q ? `${q}p` : t('yt_choice_0')),
    el('small', {}, q === 720 ? 'HD' : q === 1080 ? 'Full HD' : ' '),
    withCost ? el('em', {}, t(`yt_cost_${q}`)) : null)));
  radioKeys(group);
}

function buildLevels() {
  const group = $('#levels');
  group.replaceChildren(...LEVELS.map(level => el('div', { class: 'level', role: 'radio', tabindex: '-1', dataset: { level } },
    el('h3', {}, el('span', { class: 'radio', 'aria-hidden': 'true' }), t(`level_${level}`)),
    level === 'balanced' ? el('span', { class: 'tag' }, t('level_default')) : null,
    el('p', { class: 'level-desc' }, t(`level_${level}_desc`)),
    el('div', { class: 'k' }, t('opt_saves')),
    el('ul', { class: 'saves' }, ...LEVEL_PARTS[level].saves.map(key => el('li', {}, t(key)))),
    el('div', { class: 'k' }, t('opt_may_break')),
    el('ul', { class: 'breaks' }, el('li', {}, t(LEVEL_PARTS[level].breaks))))));
  for (const card of $$('.level', group)) card.addEventListener('click', () => act({ type: MSG.LEVEL_SET, level: card.dataset.level }));
  radioKeys(group);
}

function buildSavers() {
  $('#saver-rows').replaceChildren(...SAVERS.map(saver => el('div', { class: 'row saver top' },
    el('div', { class: 'txt' },
      el('span', { class: 't', id: `saver-${saver}-label` }, t(`saver_${saver}_name`)),
      el('span', { class: 'd' }, el('b', { class: 'ok' }, t('opt_saves')), ' ', t(`saver_${saver}_saves`)),
      el('span', { class: 'd' }, el('b', { class: 'br' }, t('opt_may_break')), ' ', t(`saver_${saver}_breaks`)),
      saver === 'autoplay' ? el('span', { class: 'd astrelle-note', hidden: true }, t('opt_astrelle_autoplay')) : null),
    el('button', { class: 'switch', role: 'switch', 'aria-labelledby': `saver-${saver}-label`, dataset: { saver } }))));
  for (const toggle of $$('#saver-rows .switch')) {
    toggle.addEventListener('click', () => {
      if (!view?.settings.saver) return;
      set({ [toggle.dataset.saver]: toggle.getAttribute('aria-checked') !== 'true' });
    });
  }
}

// ----- Showing the settings ---------------------------------------------------------------------

function renderPlan() {
  const { settings, summary } = view;
  show($('#budget'), gbText(settings.budgetGB));
  setRadio($('#period-kind'), 'kind', settings.period.kind);
  $('#monthly-fields').hidden = settings.period.kind !== 'monthly';
  $('#days-fields').hidden = settings.period.kind !== 'days';
  if (settings.period.kind === 'monthly') show($('#period-day'), String(settings.period.day));
  else {
    show($('#period-every'), String(settings.period.every));
    show($('#period-from'), settings.period.from);
  }
  fill($('#plan-lead'), 'opt_plan_lead', [summary.text.renews, summary.text.days]);
  $('#other-line').hidden = !view.otherBytes;
  fill($('#other'), 'opt_counted_elsewhere', [formatSigned(view.otherBytes, formatter())]);
  $('#left-now').disabled = !summary.hasBudget;
  $('#left-set').disabled = !summary.hasBudget;
}

function renderLevel() {
  const { settings, savingLevel } = view;
  setRadio($('#levels'), 'level', savingLevel);
  for (const card of $$('.level')) card.classList.toggle('on', card.dataset.level === savingLevel);
  $('#paused').hidden = settings.saver;
  $('#custom-note').hidden = savingLevel !== 'custom';
  const choice = settings.youtube ? `${settings.youtube}p` : t('yt_choice_0');
  fill($('#locked-note'), 'opt_locked_note', [el('b', {}, choice)]);
}

function renderSavers() {
  const { settings } = view;
  for (const toggle of $$('#saver-rows .switch')) setSwitch(toggle, settings[toggle.dataset.saver], !settings.saver);
  for (const note of $$('.astrelle-note')) note.hidden = !view.astrelle;
  setRadio($('#yt'), 'q', settings.youtube);
}

function ruleLabel(saver, on) {
  return t(`opt_rule_${saver}_${on ? 'on' : 'off'}`);
}

function renderRules() {
  const { settings } = view;
  const hosts = Object.keys(settings.sites);
  $('#no-rules').hidden = hosts.length > 0;
  $('#site-rules').replaceChildren(...hosts.map(host => {
    const rule = settings.sites[host];
    return el('li', {},
      el('span', { class: 'h' }, el('bdi', {}, host)),
      el('span', { class: 'rules' }, ...RULE_SAVERS.map(saver => {
        const on = typeof rule[saver] === 'boolean' ? rule[saver] : settings[saver];
        const button = el('button', { class: `rule${saver in rule ? ' set' : ''}`, role: 'switch', 'aria-checked': String(on), title: ruleLabel(saver, on) }, t(`popup_chip_${saver}`));
        button.addEventListener('click', () => act({ type: MSG.SITE_SET, host, overrides: { ...rule, [saver]: !on } }));
        return button;
      })),
      el('button', { class: 'x', 'aria-label': t('opt_remove_site', [host]), onclick: () => act({ type: MSG.SITE_SET, host, overrides: null }) }, '✕'));
  }));
}

function renderCounting() {
  const { settings } = view;
  show($('#overhead'), String(settings.overhead));
  $('#overhead-value').textContent = `+${formatter().number(settings.overhead, settings.overhead % 1 ? 1 : 0)}%`;
  setSwitch($('#notify-switch'), settings.notify);
  setSwitch($('#pace-switch'), settings.notifyPace);
  const { summary } = view;
  $('#sample-title').textContent = t('notif_level_title', ['75']);
  const left = summary.hasBudget ? Math.max(0, summary.left) : 12.5e9;
  const days = plural('sum_days', summary.daysLeft, [isolate(formatter().number(summary.daysLeft))]);
  $('#sample-body').textContent = summary.topSite
    ? t('notif_level_body', [isolate(size(left)), days, isolate(summary.topSite.host), isolate(size(summary.topSite.bytes))])
    : t('notif_level_body_plain', [isolate(size(left)), days]);
  $('#private-status').textContent = t(view.privateAllowed ? 'opt_private_on' : 'opt_private_off');
  setRadio($('#lang'), 'lang', settings.lang);
}

function render() {
  renderPlan();
  renderLevel();
  renderSavers();
  renderRules();
  renderCounting();
}

async function refresh() {
  const reply = await send({ type: MSG.VIEW });
  if (!reply?.ok) return;
  view = reply.view;
  if (!$('#page').hidden) render();
  if (!$('#first-run').hidden) renderFirst();
}

// ----- First run --------------------------------------------------------------------------------

let firstLevel = 'balanced';
let firstYoutube = 480;

function renderFirst() {
  setRadio($('#f-level'), 'level', firstLevel);
  $('#f-level-desc').textContent = t(`level_${firstLevel}_desc`);
  setRadio($('#f-yt'), 'q', firstYoutube);
  $('#f-yt-cost').textContent = t(`yt_cost_${firstYoutube}`);
}

function wireFirst() {
  for (const radio of $$('#f-level [role="radio"]')) {
    radio.addEventListener('click', () => { firstLevel = radio.dataset.level; renderFirst(); });
  }
  radioKeys($('#f-level'));
  ytChoices($('#f-yt'), false);
  for (const radio of $$('#f-yt [role="radio"]')) {
    radio.addEventListener('click', () => { firstYoutube = Number(radio.dataset.q); renderFirst(); });
  }
  $('#f-done').addEventListener('click', async () => {
    const day = Math.round(Number($('#f-day').value)) || 1;
    const patch = { ...applyLevel(firstLevel), youtube: firstYoutube, budgetGB: $('#f-budget').value || 0,
      period: { kind: 'monthly', day }, firstRunDone: true };
    await send({ type: MSG.SETTINGS_SET, patch });
    const used = toBytes($('#f-used').value);
    if ($('#f-used').value.trim() && used !== null) await send({ type: MSG.CARRIER_SET, usedSoFar: used });
    history.replaceState(null, '', 'options.html');
    $('#first-run').hidden = true;
    $('#page').hidden = false;
    await refresh();
  });
}

// ----- Wiring -----------------------------------------------------------------------------------

function wire() {
  buildLevels();
  buildSavers();
  ytChoices($('#yt'), true);
  for (const input of $$('input')) input.addEventListener('input', () => { input.dataset.dirty = '1'; });

  const commit = (input, run) => input.addEventListener('change', async () => {
    await run(input.value);
    delete input.dataset.dirty;
    input.blur?.();
    await refresh();
  });
  commit($('#budget'), value => send({ type: MSG.SETTINGS_SET, patch: { budgetGB: value || 0 } }));
  commit($('#period-day'), value => send({ type: MSG.SETTINGS_SET, patch: { period: { kind: 'monthly', day: value } } }));
  const daysPeriod = () => ({ kind: 'days', every: $('#period-every').value, from: $('#period-from').value });
  commit($('#period-every'), () => send({ type: MSG.SETTINGS_SET, patch: { period: daysPeriod() } }));
  commit($('#period-from'), () => send({ type: MSG.SETTINGS_SET, patch: { period: daysPeriod() } }));
  for (const radio of $$('#period-kind [role="radio"]')) {
    radio.addEventListener('click', () => {
      if (radio.dataset.kind === view?.settings.period.kind) return;
      const period = radio.dataset.kind === 'days'
        ? { kind: 'days', every: 30, from: dayKey(new Date()) }
        : { kind: 'monthly', day: new Date().getDate() };
      set({ period });
    });
  }
  radioKeys($('#period-kind'));

  const carrier = async (input, key) => {
    const bytes = toBytes(input.value);
    if (bytes === null) return;
    await act({ type: MSG.CARRIER_SET, [key]: bytes });
    input.value = '';
    delete input.dataset.dirty;
  };
  $('#used-set').addEventListener('click', () => carrier($('#used-so-far'), 'usedSoFar'));
  $('#left-set').addEventListener('click', () => carrier($('#left-now'), 'leftNow'));
  $('#other-clear').addEventListener('click', () => act({ type: MSG.CARRIER_SET, clear: true }));
  confirmTwice($('#renew'), () => act({ type: MSG.RENEW_TODAY }));
  $('#resume').addEventListener('click', () => set({ saver: true }));

  for (const radio of $$('#yt [role="radio"]')) radio.addEventListener('click', () => set({ youtube: Number(radio.dataset.q) }));

  $('#add-site').addEventListener('submit', event => {
    event.preventDefault();
    const host = normalizeHost($('#add-host').value);
    $('#add-error').hidden = !!host;
    if (!host) return;
    $('#add-host').value = '';
    act({ type: MSG.SITE_SET, host, overrides: { ...(view.settings.sites[host] ?? {}), ...ADD_PRESETS[$('#add-what').value] } });
  });

  $('#overhead').addEventListener('input', () => {
    const value = Number($('#overhead').value);
    $('#overhead-value').textContent = `+${formatter().number(value, value % 1 ? 1 : 0)}%`;
  });
  commit($('#overhead'), value => send({ type: MSG.SETTINGS_SET, patch: { overhead: value } }));
  $('#notify-switch').addEventListener('click', () => set({ notify: !view.settings.notify }));
  $('#pace-switch').addEventListener('click', () => set({ notifyPace: !view.settings.notifyPace }));
  for (const radio of $$('#lang [role="radio"]')) radio.addEventListener('click', () => set({ lang: radio.dataset.lang }));
  radioKeys($('#lang'));
  confirmTwice($('#clear-history'), () => act({ type: MSG.HISTORY_CLEAR }));

  let pending = null;
  api.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if ('opt.lang' in changes) {
      await localize();
      buildLevels();
      buildSavers();
      ytChoices($('#yt'), true);
      for (const radio of $$('#yt [role="radio"]')) radio.addEventListener('click', () => set({ youtube: Number(radio.dataset.q) }));
    }
    if (!Object.keys(changes).some(key => key === 'summary' || key.startsWith('opt.'))) return;
    clearTimeout(pending);
    pending = setTimeout(refresh, 150);
  });
}

async function start() {
  await localize();
  wire();
  wireFirst();
  const reply = await send({ type: MSG.VIEW });
  view = reply?.view ?? null;
  const showFirst = first && view && !view.settings.firstRunDone;
  $('#first-run').hidden = !showFirst;
  $('#page').hidden = showFirst;
  if (showFirst) {
    renderFirst();
    $('#f-budget').focus();
  } else if (view) {
    render();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }
}

start();
