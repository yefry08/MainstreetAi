/**
 * English / Spanish.
 *
 * Two languages, so no keys and no dictionary files: every string is written
 * as a pair where it is used -- tr('Time stopped', 'Tiempo detenido') -- and the
 * translation sits next to the English it translates, where a change to one
 * is seen beside the other.
 *
 * The language comes from the visitor's choice (remembered in localStorage),
 * else the browser's language: Spanish for any es-*, English otherwise.
 */
import { createContext, useContext } from 'react'

export const LangContext = createContext('en')

export function initialLang() {
  try {
    const saved = localStorage.getItem('lang')
    if (saved === 'es' || saved === 'en') return saved
  } catch { /* storage blocked: fall through to the browser language */ }
  return /^es\b/i.test(navigator.language || '') ? 'es' : 'en'
}

export function saveLang(lang) {
  try { localStorage.setItem('lang', lang) } catch { /* not remembered; still applied */ }
  document.documentElement.lang = lang
}

export const useLang = () => useContext(LangContext)

/** tr(english, spanish) for the current language. */
export function useT() {
  const lang = useContext(LangContext)
  return (en, es) => (lang === 'es' ? es : en)
}
