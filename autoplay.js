// Stops video and audio from playing or preloading unless the person asked for it.
// The background script registers this only while the autoplay saver is on, and never
// for allowed sites, so it can act at once instead of waiting to read settings.

(() => {
  // A play() within this long after a click or key press counts as the person's choice.
  const INPUT_GRACE_MS = 10000;
  let lastInput = 0;

  const noteInput = () => { lastInput = Date.now(); };
  addEventListener('pointerdown', noteInput, true);
  addEventListener('keydown', noteInput, true);

  const asked = () => Date.now() - lastInput < INPUT_GRACE_MS;

  function tame(media) {
    if (asked()) return;
    media.autoplay = false;
    media.preload = 'none';
    if (!media.paused) media.pause();
  }

  function tameWithin(node) {
    if (node instanceof HTMLMediaElement) tame(node);
    else if (node.querySelectorAll) node.querySelectorAll('video, audio').forEach(tame);
  }

  document.addEventListener('play', e => {
    if (e.target instanceof HTMLMediaElement && !asked()) e.target.pause();
  }, true);

  new MutationObserver(records => {
    for (const r of records) r.addedNodes.forEach(tameWithin);
  }).observe(document, { childList: true, subtree: true });
  tameWithin(document);
})();
