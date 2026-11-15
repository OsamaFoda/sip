import { DEFAULT_SETTINGS } from './lib.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);

let settings;
let savedTimer;

async function save() {
  await api.storage.local.set({ settings });
  $('saved').textContent = 'Saved.';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1500);
}

function renderAllow() {
  $('allow').replaceChildren(...settings.allow.map(site => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      settings.allow = settings.allow.filter(d => d !== site);
      renderAllow();
      await save();
    });
    li.append(name, remove);
    return li;
  }));
  $('no-allow').hidden = settings.allow.length > 0;
}

async function init() {
  const stored = await api.storage.local.get('settings');
  settings = { ...DEFAULT_SETTINGS, ...stored.settings };

  $('budgetGB').value = settings.budgetGB;
  $('resetDay').value = settings.resetDay;
  $('notify').checked = settings.notify;
  $('youtube').value = String(settings.youtube);
  renderAllow();

  $('budgetGB').addEventListener('change', e => {
    const value = parseFloat(e.target.value);
    settings.budgetGB = value > 0 ? value : 0;
    e.target.value = settings.budgetGB;
    save();
  });
  $('resetDay').addEventListener('change', e => {
    const value = Math.round(parseFloat(e.target.value));
    settings.resetDay = value >= 1 && value <= 31 ? value : 1;
    e.target.value = settings.resetDay;
    save();
  });
  $('notify').addEventListener('change', e => {
    settings.notify = e.target.checked;
    save();
  });
  $('youtube').addEventListener('change', e => {
    settings.youtube = Number(e.target.value);
    save();
  });
  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete all of Sip\'s usage history? This cannot be undone.')) return;
    await api.runtime.sendMessage({ type: 'clear' });
    $('saved').textContent = 'History deleted.';
  });
}

init();
