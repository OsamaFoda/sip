// Puts Sip's strings into a page: an element with a data-i18n key gets that string as its text,
// one with data-i18n-attr (pairs of attribute:key, separated by ;) gets its attributes, and
// <html> its lang and dir. Pages start hidden (class="i18n-pending") until
// the language Sip uses is loaded, so nothing flashes in the wrong language or direction.
import { initI18n, t, uiDir, uiLocale } from '../lib/i18n.js';

const api = globalThis.browser ?? globalThis.chrome;

export function applyStrings(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
  const html = document.documentElement;
  html.lang = uiLocale();
  html.dir = uiDir();
  html.classList.remove('i18n-pending');
}

// Loads the language the person chose (opt.lang, or the browser's) and applies it.
export async function localize(root = document) {
  let lang = 'auto';
  try {
    lang = (await api.storage.local.get('opt.lang'))['opt.lang'] ?? 'auto';
  } catch {
    // Not inside the extension (a test fixture without storage): the browser's language.
  }
  await initI18n(lang);
  applyStrings(root);
}
