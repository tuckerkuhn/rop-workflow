import { describe, expect, it } from "vitest";
import { ALL_MODULES, modulesChangeSchema, placeAllowed } from "@/lib/project-modules";

describe("what a project uses", () => {
  it("keeps every page while every part is on", () => {
    for (const h of ["/work/grants", "/design", "/work", "/progress/report"]) expect(placeAllowed(h, ALL_MODULES)).toBe(true);
  });
  it("takes only a switched-off part's pages out of the menus", () => {
    const m = { grants: false, market: true };
    expect(placeAllowed("/work/grants", m)).toBe(false);
    expect(placeAllowed("/work/grants?new=1", m)).toBe(false);
    expect(placeAllowed("/design", m)).toBe(true);
    expect(placeAllowed("/work", m)).toBe(true);
    expect(placeAllowed("/design?project=A-2027", { grants: true, market: false })).toBe(false);
    expect(placeAllowed("/designs", { grants: true, market: false })).toBe(true);
  });
  it("a change names only the parts switched, and at least one", () => {
    expect(modulesChangeSchema.safeParse({ market: false }).success).toBe(true);
    expect(modulesChangeSchema.safeParse({}).success).toBe(false);
    expect(modulesChangeSchema.safeParse({ grants: "no" }).success).toBe(false);
  });
});
