import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_HELP, registerMarkdown } from "@/lib/field-help";
import { en } from "@/lib/i18n/en";
import { fhEn, fhEs, fhFa, fhPs } from "@/lib/i18n/field-help";

const DOC = path.resolve(import.meta.dirname, "../../../docs/DATA-PROTECTION.md");
const START = "<!-- field-help:start (generated from src/lib/field-help.ts; edit the register, then run UPDATE_DOCS=1 npm test) -->";
const END = "<!-- field-help:end -->";

describe("why we ask", () => {
  it("every entry says why, and has no empty line", () => {
    for (const [k, e] of Object.entries(FIELD_HELP)) for (const key of [e.field, e.why, ...("protect" in e ? [e.protect] : []), ...("source" in e ? [e.source] : [])]) expect(en[key].trim().length, `${k}: ${key}`).toBeGreaterThan(2);
  });
  it("is in all four languages", () => {
    for (const k of Object.keys(fhEn) as (keyof typeof fhEn)[]) {
      expect(fhEs[k], `es:${k}`).toBeTruthy();
      expect(fhFa[k], `fa:${k}`).toBeTruthy();
      expect(fhPs[k], `ps:${k}`).toBeTruthy();
    }
  });
  it("the data protection document carries the same register, word for word", () => {
    const doc = readFileSync(DOC, "utf8");
    const want = `${START}\n${registerMarkdown()}\n${END}`;
    if (process.env.UPDATE_DOCS === "1" && doc.includes(START)) writeFileSync(DOC, doc.slice(0, doc.indexOf(START)) + want + doc.slice(doc.indexOf(END) + END.length));
    expect(readFileSync(DOC, "utf8")).toContain(want);
  });
});
