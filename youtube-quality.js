// Tells youtube-player.js, which runs in YouTube's own page and can't read Sip's settings, the
// highest video quality to allow.
(globalThis.browser ?? chrome).storage.local.get('settings').then(({ settings }) => {
  document.documentElement.dataset.sipYoutube = String(settings?.youtube ?? 480);
});
