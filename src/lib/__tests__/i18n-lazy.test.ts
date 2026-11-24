import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { fa } from "@/lib/i18n/fa";
import { addMessages, hasMessages, loadMessages, translate, type MessageKey } from "@/lib/i18n";
import { captionWithDate as pageCaption } from "@/lib/weekly-caption";
import { captionWithDate as docCaption } from "@/lib/weekly-docx";

/** Spanish, Dari and Pashto load only for someone reading them; English is always there. */
describe("interface languages loaded on demand", () => {
  const key = (Object.keys(es) as MessageKey[]).find((k) => es[k] && es[k] !== en[k])!;

  it("shows English for a language not loaded yet, never a blank", async () => {
    expect(hasMessages("en")).toBe(true);
    if (!hasMessages("ps")) expect(translate("ps", key)).toBe(en[key]);
    await loadMessages("ps");
    expect(hasMessages("ps")).toBe(true);
    expect(translate("ps", key).length).toBeGreaterThan(0);
  });

  it("uses a language once it has loaded", async () => {
    expect(await loadMessages("es")).toBe(es);
    expect(translate("es", key)).toBe(es[key]);
  });

  it("takes a dictionary handed over by the root layout, so the first screen is already translated", () => {
    addMessages("fa", fa);
    expect(hasMessages("fa")).toBe(true);
    const k = (Object.keys(fa) as MessageKey[]).find((x) => fa[x] && fa[x] !== en[x])!;
    expect(translate("fa", k)).toBe(fa[k]);
  });
});

describe("English pages download only English", () => {
  const dir = join(__dirname, "../i18n");
  const read = (p: string) => readFileSync(join(dir, `${p}.ts`), "utf8");
  const enImports = [...read("en").matchAll(/from "\.\/([\w/-]+)"/g)].map((m) => m[1]);

  it("every sub-dictionary English imports holds English only; the other languages sit in their own modules", () => {
    expect(enImports.length).toBeGreaterThan(0);
    for (const p of enImports) {
      expect(read(p), p).not.toMatch(/^export const \w+(Es|Fa|Ps)\b/m);
      for (const lang of ["es", "fa", "ps"]) expect(read(lang), `${lang} imports ${p}.${lang}`).toContain(`from "./${p}.${lang}";`);
    }
  });
});

describe("weekly photo captions", () => {
  it("read the same on the page as in the Word file", () => {
    for (const [c, taken] of [["Pruning in Kama.", "2026-10-03"], ["Pruning, 2026", "2026-10-03"], ["  Nursery  ", undefined], ["", "2026-01-01"]] as const)
      expect(pageCaption(c, taken)).toBe(docCaption(c, taken));
  });
});
