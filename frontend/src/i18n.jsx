import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { DE } from './de.js'

const Ctx = createContext({ lang: 'en', setLang: () => {}, t: (s) => s })

// Keys are the English phrases. Missing translations fall back to English. "{n}" style placeholders are supported.
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem('calex-lang') || (navigator.language?.startsWith('de') ? 'de' : 'en') } catch { return 'en' }
  })
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('calex-lang', l) } catch { /* ignore */ } document.documentElement.lang = l }
  const t = useCallback((s, vars) => {
    let out = lang === 'de' && DE[s] ? DE[s] : s
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
    return out
  }, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)
