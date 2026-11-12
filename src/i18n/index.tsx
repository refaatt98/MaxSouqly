import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ar, type TranslationKey } from './ar';
import { he } from './he';

export type Language = 'ar' | 'he';
export type TParams = Record<string, string | number>;
export type TFunction = (key: TranslationKey, params?: TParams) => string;

const dictionaries = { ar, he } as const;
const STORAGE_KEY = 'max.language';

export function translate(lang: Language, key: TranslationKey, params?: TParams): string {
  const template: string = dictionaries[lang][key] ?? ar[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

export function isTranslationKey(key: string): key is TranslationKey {
  return key in ar;
}

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'he') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'ar';
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLanguage);

  useEffect(() => {
    // Both Arabic and Hebrew are RTL: only `lang` changes.
    document.documentElement.lang = lang;
    document.documentElement.dir = 'rtl';
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((next: Language) => setLangState(next), []);
  const t = useCallback<TFunction>((key, params) => translate(lang, key, params), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function useT(): TFunction {
  return useI18n().t;
}

export type { TranslationKey };
