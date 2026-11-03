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

/** `vars` fills {name}-style placeholders. */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  const text = dictionaries[lang][key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
