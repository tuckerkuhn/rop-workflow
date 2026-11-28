import { describe, expect, it } from "vitest";
import { actingMap, awayInput, holdersWithDelegation, ownSelf, signedName, withDelegation, type AwayState } from "@/lib/delegation";
import { userById } from "@/lib/demo";

/** MF-01: backup approvers. While someone is away, the person acting for them holds their roles. */
const u = (id: string) => userById(id)!;
const team = ["nadia", "omar", "karim", "farida", "tucker"].map(u);
const entry = (person: string, from: string, to: string, delegate?: string) => ({ id: `${person}-${from}`, person, from, to, ...(delegate ? { delegate } : {}), by: person, at: "2026-11-28T00:00:00Z" });

describe("backup approvers", () => {
  it("the delegate acts only on the days away; with nobody named, the line manager steps in after the set days", () => {
    const state: AwayState = { entries: [entry("nadia", "2026-12-01", "2026-12-10", "omar")] };
    expect(actingMap(state, team, "2026-11-30").size).toBe(0);
    expect(actingMap(state, team, "2026-12-05").get("omar")).toEqual(["nadia"]);
    expect(actingMap(state, team, "2026-12-11").size).toBe(0);
    const boss = u("nadia").reportsTo!;
    const none: AwayState = { entries: [entry("nadia", "2026-12-01", "2026-12-20")], escalateAfterDays: 3 };
    expect(actingMap(none, team, "2026-12-03").size).toBe(0);
    expect(actingMap(none, team, "2026-12-04").get(boss)).toEqual(["nadia"]);
  });

  it("the delegate holds the away person's roles, never their administrator rights, and keeps their own beside", () => {
    const state: AwayState = { entries: [entry("nadia", "2026-12-01", "2026-12-10", "omar")] };
    const omar = withDelegation(team, state, "2026-12-02").find((p) => p.id === "omar")!;
    for (const r of u("nadia").field) expect(omar.field).toContain(r);
    expect(omar.actingFor).toEqual([{ id: "nadia", name: u("nadia").name }]);
    expect(omar.admin).toBe(u("omar").admin);
    expect(ownSelf(omar).field).toEqual(u("omar").field);
    // What they sign with a borrowed role says so; with their own, it does not.
    expect(signedName(omar, (x) => x.field.includes("manager"))).toBe("Omar Sadiq on behalf of Nadia Rahimi");
    expect(signedName(omar, () => true)).toBe(u("omar").name);
  });

  it("the authority table names the delegate beside the away holder", () => {
    const state: AwayState = { entries: [entry("tucker", "2026-12-01", "2026-12-10", "nadia")] };
    expect(holdersWithDelegation({ executive: ["tucker"], finance: ["karim"] }, state, team, "2026-12-02")).toEqual({ executive: ["tucker", "nadia"], finance: ["karim"] });
  });

  it("refuses an end before the start, and naming yourself", () => {
    expect(awayInput.safeParse({ person: "nadia", from: "2026-12-10", to: "2026-12-01" }).success).toBe(false);
    expect(awayInput.safeParse({ person: "nadia", from: "2026-12-01", to: "2026-12-10", delegate: "nadia" }).success).toBe(false);
  });
});

describe("procurement signatures on behalf of someone away", async () => {
  const { completeStep, stepById } = await import("@/lib/procurement");
  it("keeps the signer's own name and says on whose behalf, so checks by name still hold", () => {
    const signing = Object.values(stepById).find((s) => s.signs)!;
    const p = { step: signing.id, signatures: {}, timeline: [], checks: {} } as never;
    const q = completeStep(p, { name: "Nadia Rahimi", date: "2026-12-02", onBehalfOf: "Karim Ahmadi" }) as unknown as { signatures: Record<string, { name: string; onBehalfOf?: string }[]> };
    expect(q.signatures[signing.signs!.doc][0]).toMatchObject({ name: "Nadia Rahimi", onBehalfOf: "Karim Ahmadi" });
  });
});
