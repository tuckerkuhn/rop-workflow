"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Lang } from "@/lib/demo";
import { LANG_COOKIE, dirOf, formatDate, translate, type MessageKey } from "@/lib/i18n";

/**
 * The interface language. The root layout reads the cookie so the first render already has the
 * right lang and dir; changing it here rewrites the cookie and flips <html> in place.
 */

type I18n = {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** An ISO date in the interface language. */
  date: (iso: string, opts?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    document.documentElement.dir = dirOf(l);
  }, []);

  const value = useMemo<I18n>(() => ({ lang, dir: dirOf(lang), setLang, t: (key, vars) => translate(lang, key, vars), date: (iso, opts) => formatDate(lang, iso, opts) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const i = useContext(I18nContext);
  if (!i) throw new Error("useT must be used inside I18nProvider");
  return i;
}
