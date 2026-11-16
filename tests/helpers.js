// Shared by the unit tests: load a language's merged strings into lib/i18n.js.
import { readFileSync } from 'node:fs';
import { setMessages } from '../lib/i18n.js';
import { makeFormatter } from '../lib/format.js';
import { t } from '../lib/i18n.js';

export function useLanguage(lang) {
  const dict = JSON.parse(readFileSync(new URL(`../_locales/${lang}/messages.json`, import.meta.url), 'utf8'));
  setMessages(dict, lang);
  return makeFormatter(lang, t);
}

// Strips the invisible direction marks Sip puts around figures in plain text.
export const plain = text => text.replace(/[⁨⁩]/g, '');
