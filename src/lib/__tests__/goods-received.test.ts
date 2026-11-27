import { describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { checkState, holderFor, maySign, mayReceive, receiverProblem, seedProcurements, stepById, type Procurement } from "@/lib/procurement";
import { documentFor } from "@/lib/procurement-docs";

/**
 * Review round 1, ISS-12 (decision D-27): Farid requested the goods, the note printed Nadia as the
 * requesting department and Laila signed it. The requester receives the goods, or one person they
 * name in their own department: never procurement, never the storekeeper.
 */
const usd = (n: number) => `$${n}`;
const by = (id: string) => users.find((u) => u.id === id)!;
const farid = by("farid");
const laila = by("laila");
const hamid = by("hamid"); // procurement manager
const bilal = by("bilal"); // storekeeper
const requisition = { "Purchase requisition": [{ as: "Submitted by (budget holder)", name: farid.name, role: "holder" as const, date: "2026-11-01" }] };
const at = (over: Partial<Procurement> = {}): Procurement => ({ ...seedProcurements()[0], plan: undefined, step: "receive", checks: {}, signatures: requisition, grn: { qty: 600, place: "Village B collection point" }, place: "Village B collection point", receiver: undefined, ...over }) as Procurement;
const check = (id: string) => stepById.receive.checks.find((c) => c.id === id)!;

describe("who receives and inspects the goods", () => {
  it("is the requester: another budget holder cannot sign the note", () => {
    const p = at();
    expect(mayReceive(farid, p)).toBe(true);
    expect(maySign(farid, p, "holder")).toBe(true);
    expect(mayReceive(laila, p)).toBe(false);
    expect(maySign(laila, p, "holder")).toBe(false);
    expect(holderFor(p, "holder")?.id).toBe("farid");
    // At any other step a budget holder's rights are as they were.
    expect(maySign(laila, { ...p, step: "requisition" }, "holder")).toBe(maySign(laila, { ...at({ signatures: {} }), step: "requisition" }, "holder"));
  });

  it("or the one person the requester names, and then not the requester", () => {
    const p = at({ receiver: { id: "laila", name: laila.name, by: farid.name, date: "2026-11-26" } });
    expect(maySign(laila, p, "holder")).toBe(true);
    expect(maySign(farid, p, "holder")).toBe(false);
    expect(holderFor(p, "holder")?.id).toBe("laila");
  });

  it("never procurement, never the storekeeper, and someone in the requester's own department", () => {
    expect(receiverProblem(farid, laila)).toBeNull();
    expect(receiverProblem(farid, hamid)).toMatch(/is in procurement/);
    expect(receiverProblem(farid, bilal)).toMatch(/storekeeper/);
    expect(receiverProblem(farid, farid)).toMatch(/receives the goods themselves/);
    expect(receiverProblem(farid, by("farida"))).toMatch(/not set up to sign for goods received/);
    // A budget holder under another line manager is not in the requester's department.
    expect(receiverProblem({ id: "x", reportsTo: "someone-else" }, laila)).toMatch(/not in the requester's department/);
    // The requester's own line manager is.
    expect(receiverProblem({ id: "x", reportsTo: laila.id }, laila)).toBeNull();
  });

  it("an older record with no requester on it falls to the budget holders, as before", () => {
    const p = at({ signatures: {} });
    expect(maySign(laila, p, "holder")).toBe(maySign(laila, { ...p, step: "requisition" }, "holder"));
  });
});

describe("what the goods received note records", () => {
  it("needs the day it arrived, the supplier's delivery note and the condition", () => {
    expect(checkState(at(), check("delivery"), usd)).toMatchObject({ ok: false, auto: true });
    expect(checkState(at(), check("delivery"), usd).detail).toContain("the day it arrived");
    const full = at({ grn: { qty: 600, place: "Village B collection point", date: "2026-11-26", deliveryNote: "GV-DN-0412", condition: "Bags sealed and dry" } });
    expect(checkState(full, check("delivery"), usd)).toMatchObject({ ok: true, detail: "Arrived 2026-11-26 · delivery note GV-DN-0412 · Bags sealed and dry" });
    expect(checkState(at({ grn: { ...full.grn!, date: "2999-01-01" } }), check("delivery"), usd).detail).toContain("in the future");
    // A tick does not stand in for them.
    expect(checkState(at({ checks: { "receive.delivery": true } }), check("delivery"), usd)).toMatchObject({ ok: false });
  });

  it("prints the real requester, the delivery details and whoever inspected in the requester's place", () => {
    const p = at({ grn: { qty: 600, place: "Village B collection point", date: "2026-11-26", deliveryNote: "GV-DN-0412", condition: "Bags sealed and dry" }, receiver: { id: "laila", name: laila.name, by: farid.name, date: "2026-11-26" } });
    const doc = documentFor(p, "Goods received note", usd, usd);
    const rows = Object.fromEntries(doc.rows);
    expect(rows["Requested by"]).toBe(farid.name);
    expect(rows["Requesting department"]).toBeUndefined();
    expect(rows["Delivered on"]).toBe("2026-11-26");
    expect(rows["Supplier's delivery note"]).toBe("GV-DN-0412");
    expect(rows["Condition on arrival"]).toBe("Bags sealed and dry");
    expect(rows["Received and inspected for the requester by"]).toBe(`${laila.name}, named by ${farid.name} on 2026-11-26`);
    expect(doc.notes?.[0]).toContain(`by ${laila.name}, whom the requester named to receive the goods`);
    // With no one named, the note says the requester inspected.
    const own = documentFor(at({ grn: p.grn }), "Goods received note", usd, usd);
    expect(own.notes?.[0]).toContain("by the person who requested the goods");
    expect(Object.fromEntries(own.rows)["Received and inspected for the requester by"]).toBeUndefined();
  });
});
