"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Lang } from "@/lib/demo";
import { LANG_COOKIE, addMessages, dirOf, formatDate, loadMessages, translate, type MessageKey, type Messages } from "@/lib/i18n";
import { translateText } from "@/lib/i18n/text";

/**
 * The interface language. The root layout reads the cookie so the first render already has the
 * right lang and dir; changing it here rewrites the cookie and flips <html> in place.
 */

type I18n = {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** A sentence keyed by its own English (lib/i18n/text.ts): tx("Record training"), tx("Planted {date}", { date }). */
  tx: (text: string, vars?: Record<string, string | number>) => string;
  /** An ISO date in the interface language. */
  date: (iso: string, opts?: Intl.DateTimeFormatOptions) => string;
};

const I18nContext = createContext<I18n | null>(null);

/** `messages`: the dictionary of `initial` when it is not English, sent by the root layout so the first render is already in that language. */
export function I18nProvider({ initial, messages, children }: { initial: Lang; messages?: Messages; children: React.ReactNode }) {
  if (messages) addMessages(initial, messages);
  const [lang, setLangState] = useState<Lang>(initial);
  const asked = useRef<Lang>(initial);

  const setLang = useCallback((l: Lang) => {
    asked.current = l;
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    const show = () => {
      // A quicker later choice wins over a language still loading.
      if (asked.current !== l) return;
      setLangState(l);
      document.documentElement.lang = l;
      document.documentElement.dir = dirOf(l);
    };
    // The screen changes once the language has loaded; if it cannot load, it changes anyway and shows English.
    loadMessages(l).then(show, show);
  }, []);

  const value = useMemo<I18n>(() => ({ lang, dir: dirOf(lang), setLang, t: (key, vars) => translate(lang, key, vars), tx: (text, vars) => translateText(lang, text, vars), date: (iso, opts) => formatDate(lang, iso, opts) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const i = useContext(I18nContext);
  if (!i) throw new Error("useT must be used inside I18nProvider");
  return i;
}
