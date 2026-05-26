import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.yaml'
import zh from './locales/zh.yaml'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    detection: {
      order: ['navigator', 'htmlTag'],
      caches: [],
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    react: {
      useSuspense: false,
    },
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    supportedLngs: ['en', 'zh'],
  })

export default i18n
