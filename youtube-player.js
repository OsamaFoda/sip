// Runs in YouTube's own page. YouTube picks its video quality from what the browser says it can
// play, so video taller than the person's limit (and above 30 frames a second) is reported as
// unplayable, and it streams the best quality within the limit instead. Its player is also asked
// for that quality, in case it doesn't ask first. A lower limit applies to the video playing
// now; a higher one from the next video.
(() => {
  const root = document.documentElement;
  const limit = () => Number(root.dataset.sipYoutube) || 0;

  for (const source of [window.MediaSource, window.ManagedMediaSource]) {
    const original = source?.isTypeSupported;
    if (!original) continue;
    source.isTypeSupported = function isTypeSupported(type) {
      const max = limit();
      const height = Number(/height=(\d+)/.exec(type)?.[1]);
      const rate = Number(/framerate=(\d+)/.exec(type)?.[1]);
      if (max && (height > max || rate > 30)) return false;
      return original.call(this, type);
    };
  }

  const LABELS = { 144: 'tiny', 240: 'small', 360: 'medium', 480: 'large', 720: 'hd720', 1080: 'hd1080' };
  const apply = () => {
    const label = LABELS[limit()];
    const player = document.getElementById('movie_player');
    if (label && player?.setPlaybackQualityRange) player.setPlaybackQualityRange(label, label);
  };
  document.addEventListener('loadstart', apply, true);

  let last = limit();
  new MutationObserver(() => {
    const now = limit();
    if (now && (!last || now < last)) apply();
    last = now;
  }).observe(root, { attributes: true, attributeFilter: ['data-sip-youtube'] });
})();
