import {
  DEFAULT_SETTINGS, GB, billingPeriod, dayKey, formatBytes, hostOf, isAllowed, sumRange,
} from './lib.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);
const ALL_SITES = { origins: ['<all_urls>'] };

let settings;

async function saveSettings() {
  await api.storage.local.set({ settings });
}

async function render() {
  // Ask the background to write out what it has measured in the last few seconds.
  await api.runtime.sendMessage({ type: 'flush' }).catch(() => {});
  const stored = await api.storage.local.get(['days', 'settings']);
  const days = stored.days || {};
  settings = { ...DEFAULT_SETTINGS, ...stored.settings };

  $('grant').hidden = await api.permissions.contains(ALL_SITES);

  const now = new Date();
  const period = billingPeriod(now, settings.resetDay);
  const used = sumRange(days, dayKey(period.start), dayKey(period.end)).total;
  const today = days[dayKey(now)] || { total: 0, sites: {} };
  const budget = settings.budgetGB * GB;

  $('period-used').textContent = formatBytes(used);
  $('today').textContent = formatBytes(today.total);
  $('budget-box').hidden = !budget;
  $('no-budget').hidden = Boolean(budget);
  if (budget) {
    const left = Math.max(0, budget - used);
    const ratio = Math.min(1, used / budget);
    $('bar-fill').style.width = `${ratio * 100}%`;
    $('bar-fill').className = ratio >= 0.9 ? 'danger' : ratio >= 0.75 ? 'warn' : '';
    $('period-left').textContent = `${formatBytes(left)} left of ${settings.budgetGB} GB`;
    $('days-left').textContent = `${period.daysLeft} day${period.daysLeft === 1 ? '' : 's'} left`;
    // What's left spread evenly over the remaining days, counting today's use as part of today.
    // Past today's share, say by how much rather than a bare 0 B.
    const pace = (left + today.total) / period.daysLeft - today.total;
    $('pace-label').textContent = pace >= 0 ? 'Safe to use today' : "Over today's share by";
    $('pace').textContent = formatBytes(Math.round(Math.abs(pace)));
    $('pace').classList.toggle('over', pace < 0);
  }

  const top = Object.entries(today.sites).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('sites').replaceChildren(...top.map(([site, bytes]) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const size = document.createElement('span');
    size.textContent = formatBytes(bytes);
    li.append(name, size);
    return li;
  }));
  $('no-sites').hidden = top.length > 0;

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const host = hostOf(tab?.url || '');
  $('site-card').hidden = !host;
  if (host) {
    $('site-name').textContent = host;
    $('site-today').textContent = formatBytes(today.sites[host] || 0);
    $('site-allow').checked = isAllowed(host, settings.allow);
    $('site-allow').onchange = async e => {
      settings.allow = e.target.checked
        ? [...settings.allow, host]
        : settings.allow.filter(d => !(host === d || host.endsWith('.' + d)));
      await saveSettings();
      // Reloading spends data, so it's offered rather than done.
      $('site-reload').hidden = false;
    };
    $('site-reload').onclick = () => { api.tabs.reload(tab.id); window.close(); };
  }

  $('saver').checked = settings.saver;
  $('savers').classList.toggle('off', !settings.saver);
  for (const input of document.querySelectorAll('#savers input')) {
    input.checked = settings[input.dataset.key];
  }
}

$('saver').addEventListener('change', async e => {
  settings.saver = e.target.checked;
  $('savers').classList.toggle('off', !settings.saver);
  await saveSettings();
});

for (const input of document.querySelectorAll('#savers input')) {
  input.addEventListener('change', async () => {
    settings[input.dataset.key] = input.checked;
    await saveSettings();
  });
}

$('grant-btn').addEventListener('click', async () => {
  if (await api.permissions.request(ALL_SITES)) $('grant').hidden = true;
});

for (const link of document.querySelectorAll('.open-options')) {
  link.addEventListener('click', e => {
    e.preventDefault();
    api.runtime.openOptionsPage();
    window.close();
  });
}

render();
