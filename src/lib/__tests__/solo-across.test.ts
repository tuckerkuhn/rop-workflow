import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, schema: {} }));

import { soloAcross } from "@/server/solo";

/** Code review of ISS-04: a bank account belongs to the organization, so any project's second-person rule binds its reconciliation. */
describe("solo mode for something the whole organization shares", () => {
  it("is blocked when any project's donor requires a second person, whichever project the request comes through", () => {
    const free = { on: true, blocked: null };
    const donor = { on: true, blocked: "ACRP's rules require a second person on every approval for this project." };
    expect(soloAcross([free, free])).toEqual({ on: true, blocked: null });
    expect(soloAcross([free, donor]).blocked).toBe(donor.blocked);
    expect(soloAcross([donor, free]).blocked).toBe(donor.blocked);
  });
  it("is on only when it is on everywhere", () => {
    expect(soloAcross([{ on: true, blocked: null }, { on: false, blocked: null }]).on).toBe(false);
    expect(soloAcross([]).on).toBe(false);
  });
});
