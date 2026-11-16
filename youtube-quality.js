// Tells youtube-player.js, which runs in YouTube's own page and can't read Sip's settings, the
// highest video quality the person chose, and the new one as soon as they change it.
// youtube/limit-<n>.js has already set it before YouTube's code ran; this keeps it current.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const tell = value => { document.documentElement.dataset.sipYoutube = String(value ?? 480); };
  api.storage.local.get('opt.youtube').then(stored => tell(stored['opt.youtube']), () => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'opt.youtube' in changes) tell(changes['opt.youtube'].newValue);
  });
})();
