import { afterEach, describe, expect, it } from "vitest";
import { bidUsd, levelFor, lowestPassing, lateBids, lowBids, routesFor, sampleNeeded, seedProcurements, setProcurementRules, setProcurementSet, soloBarred, splitRequests, valueOf, type Bid, type Procurement } from "@/lib/procurement";

afterEach(() => {
  setProcurementRules(null);
  setProcurementSet([]);
});

const bid = (over: Partial<Bid>): Bid => ({ id: "b", supplier: "Sandbox Supplier", receivedAt: "2027-03-01T10:00", amount: 100, currency: "USD", evidence: "", passes: true, failWhy: "", lowNote: "", ...over });
const base = (): Procurement => seedProcurements()[0];

describe("procurement levels, by ROP's thresholds", () => {
  it("puts a value in its level, with the threshold itself in the lower level", () => {
    expect(levelFor(500)).toBe("Micro");
    expect(levelFor(500.01)).toBe("Small");
    expect(levelFor(5000)).toBe("Small");
    expect(levelFor(5000.01)).toBe("Medium");
    expect(levelFor(25000)).toBe("Medium");
    expect(levelFor(25000.01)).toBe("Large");
  });
  it("follows the rules in force when a donor's are layered on", () => {
    setProcurementRules({ microMaxUsd: 200, smallMaxUsd: 2500, largeAboveUsd: 10000 });
    expect(levelFor(300)).toBe("Small");
    expect(levelFor(3000)).toBe("Medium");
    expect(levelFor(12000)).toBe("Large");
  });
  it("goes back to ROP's own policy when the rules are cleared", () => {
    setProcurementRules({ microMaxUsd: 200 });
    setProcurementRules(null);
    expect(levelFor(300)).toBe("Micro");
  });
});

describe("routes", () => {
  it("micro buys directly; above it, quotations", () => {
    expect(routesFor("Micro", 300)).toEqual(["direct"]);
    expect(routesFor("Small", 3000)).toEqual(["rfq"]);
  });
  it("sole source only above its threshold", () => {
    expect(routesFor("Small", 5000)).toEqual(["rfq"]);
    expect(routesFor("Medium", 5001)).toEqual(["rfq", "sole"]);
  });
});

describe("bids", () => {
  it("converts an afghani bid at its rate, and cannot compare one without a rate", () => {
    expect(bidUsd(bid({ currency: "AFN", amount: 7200, rate: 72 }))).toBe(100);
    expect(bidUsd(bid({ currency: "AFN", amount: 7200 }))).toBeNull();
  });
  it("the lowest bid that passed wins on price; a failed lower bid does not", () => {
    const p = { ...base(), bids: [bid({ id: "a", amount: 900 }), bid({ id: "b", amount: 700, passes: false }), bid({ id: "c", amount: 800 }), bid({ id: "d", amount: 100, passes: null })] };
    expect(lowestPassing(p)?.id).toBe("c");
  });
  it("a bid received after the closing date is late", () => {
    const p = { ...base(), closingDate: "2027-03-01", bids: [bid({ id: "a", receivedAt: "2027-03-01T16:00" }), bid({ id: "b", receivedAt: "2027-03-02T09:00" })] };
    expect(lateBids(p).map((b) => b.id)).toEqual(["b"]);
  });
  it("a bid under 75% of the estimate is unusually low", () => {
    const p = { ...base(), qty: 10, unitPrice: 100, bids: [bid({ id: "a", amount: 749 }), bid({ id: "b", amount: 750 })] };
    expect(lowBids(p).map((b) => b.id)).toEqual(["a"]);
  });
});

describe("distribution checks", () => {
  it("samples 10% of recipients, at least 5, or everyone when fewer", () => {
    expect(sampleNeeded(3)).toBe(3);
    expect(sampleNeeded(40)).toBe(5);
    expect(sampleNeeded(200)).toBe(20);
    expect(sampleNeeded(201)).toBe(21);
  });
});

describe("split purchases", () => {
  it("flags two requests for the same item and line that together reach a higher level", () => {
    const a = { ...base(), id: "PR-A", qty: 1, unitPrice: 400 };
    const b = { ...base(), id: "PR-B", qty: 1, unitPrice: 400 };
    setProcurementSet([a, b]);
    const s = splitRequests(a);
    expect(valueOf(a)).toBe(400);
    expect(s.combined).toBe(800);
    expect(s.alone).toBe("Micro");
    expect(s.together).toBe("Small");
    expect(s.split).toBe(true);
  });
  it("does not flag a single request", () => {
    const a = { ...base(), id: "PR-A", qty: 1, unitPrice: 400 };
    setProcurementSet([a]);
    expect(splitRequests(a).split).toBe(false);
  });
});

describe("solo mode never covers", () => {
  it("a sole source", () => {
    expect(soloBarred({ ...base(), route: "sole" })).toMatch(/sole source always needs a second person/);
  });
  it("a large award", () => {
    expect(soloBarred({ ...base(), route: "rfq", qty: 1, unitPrice: 30000 })).toMatch(/Above \$25,000, a second person always approves/);
  });
  it("a policy exception on the record", () => {
    const p = { ...base(), route: "rfq" as const, qty: 1, unitPrice: 100, issues: [{ ...({} as Procurement["issues"][number]), type: "Policy exception request" as const }] };
    expect(soloBarred(p)).toMatch(/policy exception or post-facto action/);
  });
  it("but may cover an ordinary small purchase", () => {
    expect(soloBarred({ ...base(), route: "rfq", qty: 1, unitPrice: 100, issues: [] })).toBeNull();
  });
});
