import { describe, expect, it } from "vitest";
import { fieldSteps, moveProblem, seedField } from "@/lib/field";

const farmer = (id: string, step: string) => ({ id, kind: "farmer" as const, step });

describe("moveProblem: a farmer moves only along the workflow", () => {
  it("allows staying at a step (notes, photos, checks) and every outcome the workflow has", () => {
    expect(moveProblem("distribute", farmer("F-1", "distribute"))).toBeNull();
    for (const [step, def] of Object.entries(fieldSteps)) for (const o of def.outcomes) expect(moveProblem(step, farmer("F-1", o.to))).toBeNull();
  });
  it("refuses a jump past the readiness check or the distribution", () => {
    expect(moveProblem("verify", farmer("F-9", "plant"))).toMatch(/F-9 is at .* and cannot be saved as/);
    expect(moveProblem("train", farmer("F-9", "distribute"))).not.toBeNull();
    expect(moveProblem("prepare", farmer("F-9", "complete"))).not.toBeNull();
  });
  it("refuses an old tab putting a farmer back, which would hand out inputs twice", () => {
    expect(moveProblem("plant", farmer("F-7", "distribute"))).toMatch(/reload and try again/);
    expect(moveProblem("complete", farmer("F-7", "plant"))).not.toBeNull();
  });
  it("accepts a farmer new to the project only at the first step", () => {
    expect(moveProblem(undefined, farmer("F-99", "train"))).toBeNull();
    expect(moveProblem(undefined, farmer("F-99", "distribute"))).toMatch(/not on this project's farmer list/);
  });
  it("leaves findings alone: their steps also move outside the listed outcomes", () => {
    expect(moveProblem("decide", { id: "MF-01", kind: "finding", step: "act" })).toBeNull();
  });
  it("a finished or removed farmer cannot be moved again", () => {
    expect(moveProblem("complete", farmer("F-1", "complete"))).toBeNull();
    expect(moveProblem("complete", farmer("F-1", "train"))).not.toBeNull();
    expect(moveProblem("removed", farmer("F-1", "distribute"))).not.toBeNull();
  });
  it("every seeded farmer is at a step of the workflow or at its end", () => {
    const ends = new Set(Object.values(fieldSteps).flatMap((d) => d.outcomes.map((o) => o.to)));
    for (const i of seedField()) if (i.kind === "farmer") expect(!!fieldSteps[i.step] || ends.has(i.step)).toBe(true);
  });
});
