// Interface strings. With the language set to "auto" Sip follows the browser through
// browser.i18n; with "en" or "ar" it loads that language's _locales file itself, so the
// choice works whatever language the browser is in.
//
// Messages use positional $1…$9 substitutions, and "$$" for a dollar sign, as browser.i18n does.
// plural(key, n) picks `${key}__${category}` with Intl.PluralRules (Arabic has all six).

const api = () => globalThis.browser ?? globalThis.chrome;

let messages = null;   // { key: { message } } when Sip loaded a language itself, else null
let locale = null;     // 'en' | 'ar', when known without asking the browser

export function substitute(text, subs = []) {
  if (!Array.isArray(subs)) subs = [subs];
  return text.replace(/\$(?:([1-9])|(\$+))/g, (_, index, dollars) => (index ? String(subs[index - 1] ?? '') : dollars));
}

// Tests (and pages that already hold the dictionary) set the messages directly.
export function setMessages(dict, lang = dict?.locale_code?.message ?? 'en') {
  messages = dict;
  locale = lang;
}

export async function initI18n(lang = 'auto') {
  if (lang !== 'en' && lang !== 'ar') {
    messages = null;
    locale = null;
    return uiLocale();
  }
  const url = api()?.runtime?.getURL ? api().runtime.getURL(`_locales/${lang}/messages.json`) : `/_locales/${lang}/messages.json`;
  try {
    const response = await fetch(url);
    setMessages(await response.json(), lang);
  } catch {
    messages = null;
    locale = null;
  }
  return uiLocale();
}

// The string for a key, or the key itself when there's none (so a missing string shows).
export function t(key, subs) {
  if (messages) {
    const entry = messages[key];
    return entry ? substitute(entry.message, subs) : key;
  }
  const text = api()?.i18n?.getMessage(key, subs === undefined ? undefined : (Array.isArray(subs) ? subs.map(String) : [String(subs)]));
  return text || key;
}

export const has = key => (messages ? key in messages : !!api()?.i18n?.getMessage(key));

const rules = new Map();
export function plural(key, n, subs) {
  const lang = uiLocale();
  if (!rules.has(lang)) rules.set(lang, new Intl.PluralRules(lang));
  const exact = `${key}__${rules.get(lang).select(n)}`;
  return t(has(exact) ? exact : `${key}__other`, subs);
}

export function uiLocale() {
  if (locale) return locale;
  const code = api()?.i18n?.getMessage('locale_code');
  return code === 'ar' ? 'ar' : 'en';
}

export const uiDir = () => (['ar', 'he', 'fa', 'ur'].includes(uiLocale()) ? 'rtl' : 'ltr');
