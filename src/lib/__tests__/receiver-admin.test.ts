import { describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { mayNameReceiver, seedProcurements, type Procurement } from "@/lib/procurement";
import { validateProcurementSave } from "@/server/procurement-guard";

/** Review round 1, ISS-12 gap: the requester is away and named nobody. An administrator names who receives the goods, on the same screen. */
const by = (id: string) => users.find((u) => u.id === id)!;
const farid = by("farid"); // requested the goods
const laila = by("laila");
const daniel = by("daniel"); // an administrator
const hamid = by("hamid"); // procurement manager, not an administrator
const requisition = { "Purchase requisition": [{ as: "Submitted by (budget holder)", name: farid.name, role: "holder" as const, date: "2026-11-01" }] };
const at = (over: Partial<Procurement> = {}): Procurement => ({ ...seedProcurements()[0], plan: undefined, step: "receive", checks: {}, signatures: requisition, grn: { qty: 600, place: "Village B" }, place: "Village B", receiver: undefined, ...over }) as Procurement;

describe("naming who receives the goods", () => {
  it("is the requester's, or an administrator's when the requester is away", () => {
    expect(mayNameReceiver(at(), farid)).toBe("requester");
    expect(mayNameReceiver(at(), daniel)).toBe("admin");
    expect(mayNameReceiver(at(), hamid)).toBeNull();
    expect(mayNameReceiver(at(), laila)).toBeNull();
  });
  it("only while the goods are being received and before the note is signed", () => {
    expect(mayNameReceiver(at({ step: "invoice" }), daniel)).toBeNull();
    expect(mayNameReceiver(at({ signatures: { ...requisition, "Goods received note": [{ as: "Received by", name: farid.name, role: "holder", date: "2026-11-27" }] } }), daniel)).toBeNull();
    expect(mayNameReceiver(at(), null)).toBeNull();
  });
  it("the save agrees with the screen, and records the administrator as who named them", () => {
    const named = (u: { name: string }) => at({ receiver: { id: laila.id, name: laila.name, by: u.name, date: "2026-11-27" } });
    expect(validateProcurementSave(at(), named(daniel), daniel)).toBeNull();
    expect(validateProcurementSave(at(), named(hamid), hamid)).toMatch(/^Only the person who requested the goods/);
    expect(validateProcurementSave(at(), named(farid), daniel)).toBe("The record of who was named is not complete: name them again.");
  });
});
