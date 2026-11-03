import type { Lang } from "@/lib/demo";
import { en, type MessageKey, type Messages } from "./en";
import { es } from "./es";
import { fa } from "./fa";
import { ps } from "./ps";

/**
 * Interface text in English, Spanish, Dari and Pashto. A missing string falls back to English,
 * so screens can be translated one at a time.
 */

export type { MessageKey };

export const LANGS: Lang[] = ["en", "es", "fa", "ps"];
export const LANG_COOKIE = "rop-lang";

const dictionaries: Record<Lang, Messages> = { en, es, fa, ps };

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as string[]).includes(v);
export const dirOf = (lang: Lang) => (lang === "fa" || lang === "ps" ? "rtl" : "ltr");

/**
 * Locale for dates and numbers. Dari and Pashto keep the Gregorian calendar so dates line up
 * with the month grid and with what the other languages show.
 */
const LOCALES: Record<Lang, string> = { en: "en-GB", es: "es", fa: "fa-AF-u-ca-gregory", ps: "ps-AF-u-ca-gregory" };
export const localeOf = (lang: Lang) => LOCALES[lang];

/** First day of the week: Saturday in Afghanistan, Monday in Spanish-speaking countries, Sunday otherwise. 0 = Sunday. */
export const weekStartOf = (lang: Lang) => (lang === "fa" || lang === "ps" ? 6 : lang === "es" ? 1 : 0);

/** Formats an ISO date (YYYY-MM-DD) without shifting it across time zones. */
export function formatDate(lang: Lang, iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOCALES[lang], { ...opts, timeZone: "UTC" });
}

/** `vars` fills {name}-style placeholders. */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  const text = dictionaries[lang][key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
