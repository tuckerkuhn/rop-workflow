import { z } from "zod";
import { draftStructured } from "@/server/ai-structured";
import { aiAllowed } from "@/server/limits";

/**
 * Field staff write in Dari or Pashto; the donor's report is in English. Text in Arabic script is
 * translated into English with Claude when it is saved, and the original is kept beside it. When
 * translation is not possible (no AI, over the limit, an error), the original is saved as written
 * and marked pending, so nothing is lost and MEL sees it needs translating.
 */

export type Original = { lang: "fa" | "ps" | "other"; title?: string; note?: string; captions?: Record<string, string>; pending?: boolean; model?: string };

/** Whether text is mostly in Arabic script (Dari, Pashto). */
export function inArabicScript(t: string | undefined): boolean {
  if (!t) return false;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return false;
  const arabic = t.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g) ?? [];
  return arabic.length / letters.length > 0.3;
}

const SYSTEM = [
  "You translate field notes from Afghanistan, written in Dari or Pashto, into plain English for a donor's progress report.",
  "Translate faithfully: add nothing, leave nothing out, do not summarise or improve. Keep every number, unit, date and quantity exactly.",
  "Write people's names, villages, districts and provinces in their usual English spelling (Musa Qala, Maiwand, Nesh, Sangin, Kandahar, Helmand). Keep jerib as jerib.",
  "Plain, short sentences. If a word is unclear, keep the original word in brackets.",
].join(" ");

const schema = z.object({
  language: z.enum(["fa", "ps", "other"]).describe("fa = Dari, ps = Pashto, other = anything else"),
  items: z.array(z.object({ key: z.string(), english: z.string() })).describe("One per input key, translated."),
});

/**
 * Translates the Arabic-script fields of one item (title, note, captions) into English.
 * Returns the English fields, and the original to keep; null when nothing needed translating.
 */
export async function toEnglish(by: string, fields: { title?: string; note?: string; captions?: Record<string, string> }): Promise<{ title?: string; note?: string; captions?: Record<string, string>; original: Original } | null> {
  const todo: Record<string, string> = {};
  if (inArabicScript(fields.title)) todo.title = fields.title!;
  if (inArabicScript(fields.note)) todo.note = fields.note!;
  for (const [h, c] of Object.entries(fields.captions ?? {})) if (inArabicScript(c)) todo[`caption:${h}`] = c;
  if (!Object.keys(todo).length) return null;
  const original: Original = {
    lang: "other",
    ...(todo.title ? { title: todo.title } : {}),
    ...(todo.note ? { note: todo.note } : {}),
    ...(Object.keys(todo).some((k) => k.startsWith("caption:")) ? { captions: Object.fromEntries(Object.entries(todo).filter(([k]) => k.startsWith("caption:")).map(([k, v]) => [k.slice(8), v])) } : {}),
  };
  const limited = await aiAllowed(by).catch(() => null);
  if (limited || !process.env.ANTHROPIC_API_KEY) return { ...fields, original: { ...original, pending: true } };
  try {
    const { out, model } = await translateTexts(todo);
    const en = new Map(out.items.map((i) => [i.key, i.english.trim()]));
    if ([...Object.keys(todo)].some((k) => !en.get(k))) return { ...fields, original: { ...original, pending: true } };
    const captions = { ...(fields.captions ?? {}) };
    for (const [k, v] of en) if (k.startsWith("caption:")) captions[k.slice(8)] = v.slice(0, 300);
    return {
      ...fields,
      ...(todo.title ? { title: en.get("title")!.slice(0, 120) } : {}),
      ...(todo.note ? { note: en.get("note")!.slice(0, 4000) } : {}),
      ...(fields.captions ? { captions } : {}),
      original: { ...original, lang: out.language, model },
    };
  } catch {
    return { ...fields, original: { ...original, pending: true } };
  }
}

/** The translation call itself: each keyed text into English, with the language detected. */
export async function translateTexts(todo: Record<string, string>) {
  return draftStructured({ system: SYSTEM, task: "Translate each item's text into English. Return every key you were given.", facts: Object.entries(todo).map(([key, text]) => ({ key, text })), schema, effort: "low", maxTokens: 4000 });
}
