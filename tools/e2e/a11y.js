// Run in one of Sip's pages (page_js): what fails the accessibility rules. Returns a list.
const doc = window.document;
// Computed colours come as rgb()/rgba() (0-255), or color(srgb …) with 0-1 parts for color-mix().
const parse = c => {
  const m = (c.replace(/^color\(srgb/, '').match(/[\d.]+(e-?\d+)?/g) || [0, 0, 0, 0]).map(Number);
  const k = c.startsWith('color(') ? 255 : 1;
  return { r: m[0] * k, g: m[1] * k, b: m[2] * k, a: m.length > 3 ? m[3] : 1 };
};
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const lum = ({ r, g, b }) => { const f = v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// The colour behind an element: the page's base colour with every translucent layer above it.
const background = el => {
  const layers = [];
  for (let n = el; n && n !== doc.documentElement; n = n.parentElement) layers.unshift(parse(getComputedStyle(n).backgroundColor));
  let colour = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of layers) if (layer.a > 0) colour = over(layer, colour);
  return colour;
};
const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], details:not([open]) > :not(summary)');
const problems = [];
if (!doc.title.trim()) problems.push('no <title>');
const seen = new Set();
for (const el of doc.querySelectorAll('body *')) {
  if (!visible(el) || el.closest('[aria-disabled="true"], :disabled, svg')) continue;
  if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
  const cs = getComputedStyle(el);
  const size = parseFloat(cs.fontSize);
  const key = el.tagName + ':' + el.textContent.trim().slice(0, 24);
  if (seen.has(key)) continue;
  seen.add(key);
  if (size < 12.9) problems.push(`small text ${size}px: ${key}`);
  const fg = over(parse(cs.color), background(el));
  const large = size >= 24 || (size >= 18.6 && Number(cs.fontWeight) >= 700);
  const r = ratio(fg, background(el));
  if (r < (large ? 3 : 4.5)) problems.push(`contrast ${r.toFixed(2)}: ${key}`);
}
for (const el of doc.querySelectorAll('a[href], button, input, select, textarea, [role="switch"], [role="radio"], [tabindex]')) {
  if (!visible(el)) continue;
  const labelled = el.getAttribute('aria-labelledby')?.split(' ').map(id => doc.getElementById(id)?.textContent.trim()).join(' ');
  const name = el.labels?.[0]?.textContent.trim() || el.getAttribute('aria-label') || labelled || el.textContent.trim() || el.title || el.placeholder;
  if (!name) problems.push(`no name: ${el.outerHTML.slice(0, 80)}`);
}
if (doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1) problems.push(`scrolls sideways: ${doc.documentElement.scrollWidth} > ${doc.documentElement.clientWidth}`);
return problems;
