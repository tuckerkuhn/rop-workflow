import type { Lang } from "@/lib/demo";
import { textEs } from "./text/es";
import { textFa } from "./text/fa";
import { textPs } from "./text/ps";

/**
 * Screen text keyed by its own English sentence (gettext style), beside the older keyed
 * dictionaries (en.ts). A screen writes tx("Record training") or tx("Planted {date}", { date });
 * text that lives in data (step titles, check labels) is marked msg("...") where it is written,
 * and passed through tx() where it is shown. `npm run i18n:catalog` lists every such sentence with
 * its Spanish, Dari and Pashto (docs/translation/screen-text.csv) for the translators; anything not
 * translated yet shows in English. Changing an English sentence makes it untranslated again, which
 * the catalog reports.
 */

const TEXTS: Record<Exclude<Lang, "en">, Record<string, string>> = { es: textEs, fa: textFa, ps: textPs };

/** Marks a sentence kept in data so the catalog finds it. Returns it unchanged. */
export const msg = <T extends string>(text: T): T => text;

/** The sentence in the interface language (English when not translated yet), with {name} filled in. */
export function translateText(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const out = lang === "en" ? text : (TEXTS[lang][text] ?? text);
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}
