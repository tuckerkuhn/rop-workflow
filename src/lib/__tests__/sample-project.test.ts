import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spentOver } from "@/lib/budget-view";
import { namesIn } from "@/lib/personal-text";
import { orchardPng, samplePdf } from "@/lib/sample-files";
import { onProject, SAMPLE_PREFIX } from "@/server/auth";
import { SAMPLE_INDICATORS, SAMPLE_LINES, SAMPLE_RESULTS, sampleCode } from "@/server/sample-project";

const someone = { id: "x", projects: ["ACRP-2026"], admin: false } as unknown as Parameters<typeof onProject>[0];

describe("the sample project (C5)", () => {
  it("has a code no project made in setup can have, and everyone may open it", () => {
    const code = sampleCode("4f1c2a9e-0000-4000-8000-000000000000");
    expect(code).toBe("SAMPLE-4F1C2A");
    expect(code.startsWith(SAMPLE_PREFIX)).toBe(true);
    expect(onProject(someone, code)).toBe(true);
    expect(onProject(someone, "OTHER-2026")).toBe(false);
  });
  it("names its fictional author plainly, not by the internal id", async () => {
    const { personName } = await import("@/lib/project");
    expect(personName("sample")).toBe("the sample team (fictional)");
  });
  it("has exactly one line over budget, the one whose reason it gives", () => {
    const over = SAMPLE_LINES.filter((l) => spentOver(l.spent, l.amount)).map((l) => l.code);
    expect(over).toEqual(["S-1.1.B"]);
  });
  it("records results within each target, each with proof, and names nobody", () => {
    for (const i of SAMPLE_INDICATORS) {
      const done = SAMPLE_RESULTS.filter((r) => r.indicator === i.code).reduce((t, r) => t + r.value, 0);
      expect(done).toBeGreaterThan(0);
      expect(done).toBeLessThanOrEqual(i.target);
    }
    for (const r of SAMPLE_RESULTS) {
      expect(r.proof.length).toBeGreaterThan(0);
      expect(namesIn(r.note)).toEqual([]);
      if (r.female !== undefined) expect(r.female + (r.male ?? 0)).toBe(r.value);
    }
  });
  it("makes real files: a PNG picture and a one-page PDF marked as a sample", () => {
    const png = orchardPng(3);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(480);
    expect(orchardPng(4).equals(png)).toBe(false);
    const pdf = samplePdf("Attendance sheet (sample)", ["Participants: 80"]).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("SAMPLE: fictional data");
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

describe("the sample cannot be changed", () => {
  const dir = path.resolve(import.meta.dirname, "../../app/api/projects/[code]");
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : f === "route.ts" ? [path.join(d, f)] : []));
  it("every route that changes a project asks the guard for write access, where the sample is refused", () => {
    // The assistant only answers questions; the Kobo hook is KoboToolbox's own call, with its own secret.
    const exempt = ["assistant/route.ts", "kobo/hook/route.ts"];
    const missing = files(dir)
      .filter((f) => /export async function (POST|PUT|PATCH|DELETE)/.test(readFileSync(f, "utf8")) && !readFileSync(f, "utf8").includes("write: true"))
      .map((f) => path.relative(dir, f))
      .filter((f) => !exempt.includes(f));
    expect(missing).toEqual([]);
  });
});
