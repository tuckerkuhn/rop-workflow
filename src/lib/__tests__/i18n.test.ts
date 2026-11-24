import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { fa } from "@/lib/i18n/fa";
import { ps } from "@/lib/i18n/ps";
import { awEn } from "@/lib/i18n/ai-why";
import { awEs } from "@/lib/i18n/ai-why.es";
import { awFa } from "@/lib/i18n/ai-why.fa";
import { awPs } from "@/lib/i18n/ai-why.ps";
import { sgEn } from "@/lib/i18n/surge";
import { sgEs } from "@/lib/i18n/surge.es";
import { sgFa } from "@/lib/i18n/surge.fa";
import { sgPs } from "@/lib/i18n/surge.ps";
import { rpEn } from "@/lib/i18n/report-path";
import { rpEs } from "@/lib/i18n/report-path.es";
import { rpFa } from "@/lib/i18n/report-path.fa";
import { rpPs } from "@/lib/i18n/report-path.ps";
import { tdEn } from "@/lib/i18n/target-details";
import { tdEs } from "@/lib/i18n/target-details.es";
import { tdFa } from "@/lib/i18n/target-details.fa";
import { tdPs } from "@/lib/i18n/target-details.ps";
import { translate } from "@/lib/i18n";

describe("interface text", () => {
  it("no language has a key English lacks", () => {
    const keys = new Set(Object.keys(en));
    for (const [name, d] of Object.entries({ es, fa, ps })) expect(Object.keys(d).filter((k) => !keys.has(k)), name).toEqual([]);
  });
  it("falls back to English for a string a language lacks, never to a blank", () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) for (const lang of ["es", "fa", "ps"] as const) expect(translate(lang, k).length, `${lang}:${k}`).toBeGreaterThan(0);
  });
  it("every string added in the clean-up is in all four languages", () => {
    for (const k of Object.keys(awEn) as (keyof typeof awEn)[]) {
      expect(awEs[k], `es:${k}`).toBeTruthy();
      expect(awFa[k], `fa:${k}`).toBeTruthy();
      expect(awPs[k], `ps:${k}`).toBeTruthy();
    }
    for (const k of Object.keys(tdEn) as (keyof typeof tdEn)[]) {
      expect(tdEs[k], `es:${k}`).toBeTruthy();
      expect(tdFa[k], `fa:${k}`).toBeTruthy();
      expect(tdPs[k], `ps:${k}`).toBeTruthy();
    }
    for (const k of Object.keys(rpEn) as (keyof typeof rpEn)[]) {
      expect(rpEs[k], `es:${k}`).toBeTruthy();
      expect(rpFa[k], `fa:${k}`).toBeTruthy();
      expect(rpPs[k], `ps:${k}`).toBeTruthy();
    }
    for (const k of Object.keys(sgEn) as (keyof typeof sgEn)[]) {
      expect(sgEs[k], `es:${k}`).toBeTruthy();
      expect(sgFa[k], `fa:${k}`).toBeTruthy();
      expect(sgPs[k], `ps:${k}`).toBeTruthy();
    }
  });
  it("a translation keeps the same {placeholders} as the English", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad: string[] = [];
    for (const [name, d] of Object.entries({ es, fa, ps })) for (const [k, v] of Object.entries(d)) if (v && holes(v) !== holes(en[k as keyof typeof en])) bad.push(`${name}:${k}`);
    expect(bad).toEqual([]);
  });
});
