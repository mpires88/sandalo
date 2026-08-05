'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Lang = 'en' | 'es'

interface LanguageCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (en: string, es: string) => string
}

const LanguageContext = createContext<LanguageCtx>({
  lang: 'en',
  setLang: () => {},
  t: (en) => en,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    const stored = localStorage.getItem('sandalo_lang')
    if (stored === 'en' || stored === 'es') setLangState(stored)
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('sandalo_lang', l)
  }

  function t(en: string, es: string) {
    return lang === 'es' ? es : en
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
