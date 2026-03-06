import { createContext, useContext, useState } from 'react';
import translations from '../i18n';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('lang') || 'ru');

  function setLang(l) {
    setLangState(l);
    localStorage.setItem('lang', l);
  }

  function t(key) {
    return translations[lang]?.[key] ?? translations.ru[key] ?? key;
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
