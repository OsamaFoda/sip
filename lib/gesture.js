// Whether a click or key press was meant for a video: its event path (event.composedPath())
// touched the media element or the player around it. A player's controls sit within a few
// levels of the media element; the page's body and anything above it don't count, or every
// click on the page would.
// (autoplay-main.js and autoplay.js carry copies, since content scripts can't import;
// tests/gesture.test.js keeps them equal to this one.)
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

export { pathRelatesTo };
