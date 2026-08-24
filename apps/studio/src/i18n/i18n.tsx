import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { en } from './locales/en';
import { zh } from './locales/zh';
import type { Translations } from './locales/en';

export type Locale = 'en' | 'zh';

const STORAGE_KEY = 'agent-dev.studio.locale';

const dictionaries: Record<Locale, Translations> = { en, zh };

export type KeyPath<T extends Record<string, unknown> = Translations> = {
  [K in keyof T]: T[K] extends Record<string, unknown>
    ? `${K & string}.${KeyPath<T[K]>}`
    : `${K & string}`;
}[keyof T];

function getNestedValue(obj: Translations, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function getInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    // localStorage may not be available in some environments.
  }
  return 'en';
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: KeyPath, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage errors.
    }
  }, [locale]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
  };

  const t = (key: KeyPath, params?: Record<string, string | number>): string => {
    const dictionary = dictionaries[locale];
    let value = getNestedValue(dictionary, key);
    if (value === undefined) {
      // Fallback to English if key is missing.
      value = getNestedValue(dictionaries.en, key);
    }
    if (value === undefined) {
      return key;
    }
    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
    }
    return value;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
