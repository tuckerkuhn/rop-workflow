import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_JOBS, scrubKeys } from "@/lib/ai-jobs";
import { asIs, plainAiError, scrubbed } from "@/server/ai";

const src = path.resolve(import.meta.dirname, "../..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : /\.tsx?$/.test(f) ? [path.join(dir, f)] : []));
const code = files(src).filter((f) => !f.includes("__tests__"));
const rel = (f: string) => path.relative(src, f);

describe("one door for AI", () => {
  it("only server/ai.ts imports the AI SDK", () => {
    const importers = code.filter((f) => /from "@anthropic-ai\/sdk/.test(readFileSync(f, "utf8"))).map(rel);
    expect(importers).toEqual(["server/ai.ts"]);
  });
  it("every call names a job from the list", () => {
    const used = new Set<string>();
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      if (!/from "@\/server\/ai(-structured)?"/.test(text)) continue;
      for (const m of text.matchAll(/\bjob: "([A-Za-z]+)"/g)) used.add(m[1]);
    }
    for (const j of used) expect(Object.keys(AI_JOBS), j).toContain(j);
    // The three setup readers pass their job as an argument.
    for (const j of ["setupDesign", "setupTerms", "setupBudget"]) expect(readFileSync(path.join(src, "server/setup-extract.ts"), "utf8")).toContain(`"${j}"`);
    expect(used.size).toBeGreaterThanOrEqual(14);
  });
  it("every job says what it does and what it looks at, in words", () => {
    for (const [name, j] of Object.entries(AI_JOBS)) {
      expect(j.label.length, name).toBeGreaterThan(8);
      expect(j.looksAt.length, name).toBeGreaterThan(8);
    }
  });
  it("jobs that write for people carry the voice rules", () => {
    for (const j of ["storyDraft", "qprDraft", "monthlyReview", "procurementDraft", "postDraft", "assistant"] as const) expect(AI_JOBS[j].voice, j).toBe(true);
  });
});

describe("personal text on the way to the AI", () => {
  const facts = {
    project: "Sandbox Project",
    indicator: "Women's groups trained",
    results: [{ date: "2026-08-01", province: "Kandahar", note: "Visited the plot in Sorkhab Village with Haji Baryal Noorzad." }],
    updates: [{ title: "Torpekai's greenhouse", note: ["We met Zarmal's family."] }],
    count: 3,
  };
  it("replaces names in the free-text fields named, at any depth", () => {
    const out = scrubKeys(facts, ["note", "title"]) as typeof facts;
    expect(out.results[0].note).toBe("Visited the plot in a village with a farmer.");
    expect(out.updates[0].title).toBe("a farmer's greenhouse");
    expect(out.updates[0].note[0]).toBe("We met a farmer's family.");
    expect(JSON.stringify(out)).not.toMatch(/Sorkhab|Baryal|Torpekai|Zarmal/);
  });
  it("leaves everything else exactly as it was", () => {
    const out = scrubKeys(facts, ["note", "title"]) as typeof facts;
    expect(out.project).toBe("Sandbox Project");
    expect(out.indicator).toBe("Women's groups trained");
    expect(out.results[0].province).toBe("Kandahar");
    expect(out.count).toBe(3);
  });
  it("does not change what it was given", () => {
    const before = JSON.stringify(facts);
    scrubKeys(facts, ["note", "title"]);
    expect(JSON.stringify(facts)).toBe(before);
  });
  it("records how the facts were handled, for the audit row", () => {
    expect(scrubbed(facts, ["note", "title"]).how).toBe("names replaced in: note, title");
    expect(asIs(facts, "figures only").how).toBe("as is: figures only");
    expect((scrubbed(facts, ["note"]).value as typeof facts).results[0].note).not.toMatch(/Baryal/);
  });
});

describe("AI failures in plain words", () => {
  it("never passes on a raw error", () => {
    const msg = plainAiError(new TypeError("Cannot read properties of undefined (reading 'x')"), false);
    expect(msg).not.toMatch(/undefined|properties/);
    expect(msg).toMatch(/Nothing was changed/);
    expect(msg).toMatch(/by hand/);
  });
  it("says what to do when it took too long, in the job's own words when given", () => {
    expect(plainAiError(new Error("aborted"), true)).toMatch(/took too long/);
    expect(plainAiError(new Error("aborted"), true, { tooLong: "Draft fewer sections at once." })).toBe("Draft fewer sections at once.");
  });
});
