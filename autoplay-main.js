// Runs in the page's own world, before its scripts. A page that calls play() on its own gets
// the refusal browsers give blocked autoplay; a play the person asked for (a click or key press
// on the player, a YouTube video they chose) goes through. Media made by script starts with
// preload="none", so it doesn't download until it plays. autoplay.js, in Sip's world, does the
// rest: autoplay attributes, already-playing media, and allowed sites' frames.
(() => {
  const Media = window.HTMLMediaElement;
  if (!Media || Media.prototype.play.sipWrapped) return;
  const root = document.documentElement;

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

  const mayPlay = media => root.dataset.sipAutoplay === 'allow' || isWatchPage(location.href) ||
    (navigator.userActivation?.isActive === true && pathRelatesTo(media, lastPath));

  // autoplay.js counts what was stopped; the event goes on the media so it is counted once.
  const stopped = media => {
    const target = media.isConnected ? media : document;
    target.dispatchEvent(new Event('sip:media-stopped', { bubbles: true, composed: true }));
  };

  const nativePlay = Media.prototype.play;
  const play = function play() {
    if (mayPlay(this)) return nativePlay.call(this);
    stopped(this);
    return Promise.reject(new DOMException('Sip stopped this from playing on its own.', 'NotAllowedError'));
  };
  play.sipWrapped = true;
  Object.defineProperty(Media.prototype, 'play', { value: play, writable: true, configurable: true });

  const nativeCreate = Document.prototype.createElement;
  Document.prototype.createElement = function createElement(...args) {
    const element = nativeCreate.apply(this, args);
    if (element instanceof Media && root.dataset.sipAutoplay !== 'allow' && !isWatchPage(location.href)) element.preload = 'none';
    return element;
  };

  const NativeAudio = window.Audio;
  if (NativeAudio) {
    const Audio = function Audio(src) {
      const audio = new NativeAudio();
      if (root.dataset.sipAutoplay !== 'allow' && !isWatchPage(location.href)) audio.preload = 'none';
      if (src !== undefined) audio.src = src;
      return audio;
    };
    Audio.prototype = NativeAudio.prototype;
    window.Audio = Audio;
  }

  // Tells autoplay.js about shadow roots made after their host was added, closed ones included.
  const nativeAttach = Element.prototype.attachShadow;
  if (nativeAttach) {
    Element.prototype.attachShadow = function attachShadow(...args) {
      const shadow = nativeAttach.apply(this, args);
      if (this.isConnected) this.dispatchEvent(new Event('sip:shadow'));
      return shadow;
    };
  }
})();
