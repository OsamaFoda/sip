// Tells youtube-player.js, which runs in YouTube's own page and can't read Sip's settings, the
// highest video quality to allow, and the new one when it changes (from the next video on).
const api = globalThis.browser ?? chrome;
const tell = settings => (document.documentElement.dataset.sipYoutube = String(settings?.youtube ?? 480));
api.storage.local.get('settings').then(({ settings }) => tell(settings));
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) tell(changes.settings.newValue);
});
