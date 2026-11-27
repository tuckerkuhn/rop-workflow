import { describe, expect, it } from "vitest";
import { PLACES, PROVINCES, placesFor } from "@/lib/results";

/** Review round 1, ISS-29: a project in Guatemala was offered Afghan provinces. */
describe("the places offered follow the project's country", () => {
  it("Afghanistan has its 34 provinces and Guatemala its 22 departments, each named once", () => {
    expect(placesFor("Afghanistan")).toMatchObject({ label: "Province" });
    expect(PLACES.Afghanistan.names).toHaveLength(34);
    expect(placesFor("Guatemala")).toMatchObject({ label: "Department" });
    expect(PLACES.Guatemala.names).toHaveLength(22);
    for (const c of Object.values(PLACES)) expect(new Set(c.names).size).toBe(c.names.length);
    expect(placesFor("Guatemala")!.names).toContain("Izabal");
    expect(placesFor("Guatemala")!.names).not.toContain("Kandahar");
  });
  it("a country with no list has none, so the place is typed", () => {
    expect(placesFor("Ghana")).toBeNull();
    expect(placesFor(null)).toBeNull();
    expect(placesFor(" Afghanistan ")).not.toBeNull();
  });
  it("the provinces recorded so far are still on the list", () => {
    for (const p of ["Kandahar", "Helmand", "Uruzgan", "Zabul", "Kabul", "Herat", "Balkh", "Nangarhar"]) expect(PROVINCES).toContain(p);
  });
});
