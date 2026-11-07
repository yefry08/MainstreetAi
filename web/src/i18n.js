/**
 * The site's languages (site.js: SITE.langs) -- English, Spanish, Albanian.
 *
 * No keys and no dictionary files: every string is written where it is used,
 * as tr(english, spanish, albanian) -- the translations sit next to the
 * English they translate, where a change to one is seen beside the others. A
 * missing translation falls back to English rather than to nothing.
 *
 * The language comes from the visitor's choice (remembered in localStorage),
 * else the browser's language if the site offers it, else the site's first.
 */
import { createContext, useContext } from 'react'
import { SITE } from './site.js'

export const LangContext = createContext(SITE.langs[0])

export function initialLang() {
  try {
    const saved = localStorage.getItem('lang')
    if (SITE.langs.includes(saved)) return saved
  } catch { /* storage blocked: fall through to the browser language */ }
  const browser = (navigator.language || '').slice(0, 2).toLowerCase()
  return SITE.langs.includes(browser) ? browser : SITE.langs[0]
}

export function saveLang(lang) {
  try { localStorage.setItem('lang', lang) } catch { /* not remembered; still applied */ }
  document.documentElement.lang = lang
}

export const useLang = () => useContext(LangContext)

/** tr(english, spanish, albanian) for the current language. */
export function useT() {
  const lang = useContext(LangContext)
  return (en, es, sq) => (lang === 'es' ? es ?? en : lang === 'sq' ? sq ?? en : en)
}
