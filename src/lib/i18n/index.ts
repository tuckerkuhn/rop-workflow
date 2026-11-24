import type { Lang } from "@/lib/demo";
import { en, type MessageKey, type Messages } from "./en";

/**
 * Interface text in English, Spanish, Dari and Pashto. A missing string falls back to English,
 * so screens can be translated one at a time.
 */

export type { MessageKey };

export const LANGS: Lang[] = ["en", "es", "fa", "ps"];
export const LANG_COOKIE = "rop-lang";

/**
 * English ships with every page; Spanish, Dari and Pashto load only for someone reading them
 * (each is its own chunk). The root layout hands the reader's language to I18nProvider with the
 * first page, so nothing shows in English first; switching language loads the new one before the
 * screen changes. Until a language is loaded, translate() falls back to English.
 */
export type { Messages };
const dictionaries: Partial<Record<Lang, Messages>> = { en };
const loaders: Record<Exclude<Lang, "en">, () => Promise<Messages>> = {
  es: () => import("./es").then((m) => m.es),
  fa: () => import("./fa").then((m) => m.fa),
  ps: () => import("./ps").then((m) => m.ps),
};

export const hasMessages = (lang: Lang) => !!dictionaries[lang];

/** Keeps a language's dictionary that arrived some other way (from the root layout). */
export function addMessages(lang: Lang, messages: Messages) {
  dictionaries[lang] ??= messages;
}

/** Loads a language's dictionary (once) and returns it. */
export async function loadMessages(lang: Lang): Promise<Messages> {
  const have = dictionaries[lang];
  if (have) return have;
  const loaded = await loaders[lang as Exclude<Lang, "en">]();
  dictionaries[lang] ??= loaded;
  return loaded;
}

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

/**
 * Formats an ISO date (YYYY-MM-DD) without shifting it across time zones. A full timestamp
 * (e.g. 2027-01-22T01:58:00Z) shows the day it is where the reader is.
 */
export function formatDate(lang: Lang, iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso).toLocaleDateString(LOCALES[lang], opts);
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(LOCALES[lang], { ...opts, timeZone: "UTC" });
}

/** `vars` fills {name}-style placeholders. */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  const text = dictionaries[lang]?.[key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
