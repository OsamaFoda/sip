// Stops video and audio from playing or preloading unless the person asked for it.
// The background registers this only while the autoplay saver is on, and not on sites whose
// rule turns it off; in a frame inside such a site it asks the background and steps aside.
// autoplay-main.js covers play() calls made by the page itself.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const root = document.documentElement;
  if (root.dataset.sipAutoplay === undefined) root.dataset.sipAutoplay = 'block';
  let allowed = false;

  // <gesture>
  function pathRelatesTo(media, path, depth = 3) {
    if (!media || !path || !path.length) return false;
    const near = [];
    for (let node = media, i = 0; node && i <= depth; node = node.parentNode, i++) {
      if (node.nodeType !== 1 || node.nodeName === 'BODY' || node.nodeName === 'HTML') break;
      near.push(node);
    }
    return path.some(target => near.some(node => node === target || (target && target.nodeType === 1 && node.contains(target))));
  }
  // </gesture>

  // <watch-page>
  function isWatchPage(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) return false;
      return u.pathname === '/watch' || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/');
    } catch {
      return false;
    }
  }
  // </watch-page>

  let lastPath = [];
  const remember = event => { lastPath = event.composedPath(); };
  addEventListener('pointerdown', remember, true);
  addEventListener('keydown', remember, true);

  const asked = media => allowed || isWatchPage(location.href) ||
    (navigator.userActivation?.isActive === true && pathRelatesTo(media, lastPath));

  // What Sip changed on each element, to put back if this frame turns out to be allowed.
  const changed = new WeakMap();
  const counted = new WeakSet();
  let reports = 0;
  let pending = 0;
  let sendTimer = null;

  function count(media) {
    if (media && counted.has(media)) return;
    if (media) counted.add(media);
    if (reports >= 50) return;   // a page can fire the event itself, so it's capped
    reports += 1;
    pending += 1;
    sendTimer ??= setTimeout(() => {
      sendTimer = null;
      const n = pending;
      pending = 0;
      try {
        api.runtime.sendMessage({ type: 'media.stopped', n }).catch(() => {});
      } catch {
        // Sip was reloaded or removed; this page's script is orphaned.
      }
    }, 1000);
  }

  function tame(media) {
    if (allowed || asked(media)) return;
    if (!changed.has(media)) changed.set(media, { autoplay: media.autoplay, preload: media.getAttribute('preload') });
    const wanted = media.autoplay || !media.paused;
    media.autoplay = false;
    media.preload = 'none';
    if (!media.paused) media.pause();
    if (wanted) count(media);
  }

  const shadowOf = element => element.openOrClosedShadowRoot ?? element.shadowRoot ?? null;
  const watched = new WeakSet();

  function scan(node) {
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node instanceof HTMLMediaElement) tame(node);
    if (node.getElementsByTagName) {
      for (const tag of ['video', 'audio']) for (const media of node.getElementsByTagName(tag)) tame(media);
    } else {
      node.querySelectorAll?.('video, audio').forEach(tame);
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    for (let element = walker.currentNode; element; element = walker.nextNode()) {
      if (element.nodeType === 1) watchShadow(element);
    }
  }

  function watchShadow(element) {
    const shadow = shadowOf(element);
    if (!shadow || watched.has(shadow)) return;
    watched.add(shadow);
    observer.observe(shadow, { childList: true, subtree: true });
    shadow.addEventListener('play', onPlay, true);
    scan(shadow);
  }

  function onPlay(event) {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement) || allowed || asked(media)) return;
    media.pause();
    count(media);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(scan);
  });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('play', onPlay, true);
  document.addEventListener('sip:media-stopped', event => count(event.target instanceof HTMLMediaElement ? event.target : null), true);
  document.addEventListener('sip:shadow', event => watchShadow(event.target), true);
  scan(document);

  // In a frame, the top page's site decides: a site whose rule turns this saver off gets its
  // iframes' media back, and what Sip stopped plays again.
  if (window !== window.top) {
    try {
      api.runtime.sendMessage({ type: 'frame.allowed' }).then(reply => {
        if (!reply?.ok || !reply.autoplay) return;
        allowed = true;
        root.dataset.sipAutoplay = 'allow';
        for (const media of document.querySelectorAll('video, audio')) {
          const before = changed.get(media);
          if (!before) continue;
          if (before.preload === null) media.removeAttribute('preload');
          else media.setAttribute('preload', before.preload);
          media.autoplay = before.autoplay;
          if (before.autoplay && media.paused) media.play().catch(() => {});
        }
      }, () => {});
    } catch {
      // Orphaned script.
    }
  }
})();
