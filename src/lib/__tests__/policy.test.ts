import { describe, expect, it } from "vitest";
import { combine, compare, effective, layered, paramByKey, PARAMS, ROP, show, type Profile } from "@/lib/policy";

const donor = (values: Profile["values"]): Profile => ({ id: "sandbox-donor", name: "Sandbox Donor", kind: "donor", summary: "", documents: [], values });
const cite = (value: Profile["values"][string]["value"]) => ({ value, source: "Sandbox agreement, clause 1" });

describe("ROP's written values", () => {
  it("every value has a source", () => {
    for (const [key, v] of Object.entries(ROP.values)) expect(v.source.length, key).toBeGreaterThan(3);
  });
  it("every value belongs to a known rule", () => {
    for (const key of Object.keys(ROP.values)) expect(paramByKey[key], key).toBeDefined();
  });
  it("procurement thresholds are the April 2025 table: 500 / 5,000 / 25,000", () => {
    expect(ROP.values.microMaxUsd.value).toBe(500);
    expect(ROP.values.smallMaxUsd.value).toBe(5000);
    expect(ROP.values.largeAboveUsd.value).toBe(25000);
  });
  it("with no donor, ROP's own values apply and nothing is open", () => {
    const e = effective(ROP, null);
    expect(e.values.microMaxUsd).toBe(500);
    expect(e.values.quotesSmall).toBe(3);
    expect(e.open).toEqual([]);
    expect(e.gaps).toEqual([]);
    expect(e.lines.length).toBe(PARAMS.length);
  });
});

describe("combining an organization's rule with a donor's", () => {
  const def = (merge: (typeof PARAMS)[number]["merge"]) => PARAMS.find((p) => p.merge === merge)!;
  it("min: the lower threshold satisfies both", () => {
    expect(combine(def("min"), cite(5000), cite(2500)).value).toBe(2500);
    expect(compare(def("min"), 2500, 5000)).toBe("stricter");
    expect(compare(def("min"), 9000, 5000)).toBe("looser");
    expect(compare(def("min"), 2500, null)).toBe("stricter");
    expect(layered(def("min"), 5000, 2500)).toBe(2500);
  });
  it("max: the higher number satisfies both", () => {
    expect(combine(def("max"), cite(3), cite(5)).value).toBe(5);
    expect(compare(def("max"), 5, 3)).toBe("stricter");
    expect(layered(def("max"), 3, 5)).toBe(5);
  });
  it("any: required by one is required", () => {
    expect(combine(def("any"), cite(false), cite(true)).value).toBe(true);
    expect(compare(def("any"), true, false)).toBe("stricter");
    expect(compare(def("any"), false, true)).toBe("looser");
  });
  it("union: everything either lists, once", () => {
    expect(combine(def("union"), cite(["UN list"]), cite(["un list", "OFAC list"])).value).toEqual(["UN list", "OFAC list"]);
  });
  it("common: only what both allow; nothing in common is a conflict", () => {
    expect(combine(def("common"), cite(["RFQ", "Sole source"]), cite(["rfq"])).value).toEqual(["RFQ"]);
    const none = combine(def("common"), cite(["RFQ"]), cite(["Auction"]));
    expect(none.value).toEqual([]);
    expect(none.conflict).toMatch(/nothing in common/);
  });
  it("same: different values are a conflict with no value guessed", () => {
    const l = combine(def("same"), cite("Economy"), cite("Business"));
    expect(l.value).toBeNull();
    expect(l.conflict).toMatch(/no single value satisfies both/);
    const decided = combine(def("same"), cite("Economy"), cite("Business"), { value: "Economy", by: "u1", name: "Test Admin", at: "2026-11-01", reason: "Organization's rule kept" });
    expect(decided.value).toBe("Economy");
    expect(decided.why).toContain("Decided by Test Admin");
  });
  it("only one side sets it: that side's value", () => {
    expect(combine(def("min"), cite(5000), undefined).why).toBe("Only the organization's policy sets this.");
    expect(combine(def("min"), undefined, cite(100))).toMatchObject({ value: 100, why: "Only the donor sets this." });
  });
});

describe("effective: the rules a project follows", () => {
  it("a stricter donor rule is a gap, and ROP's value applies until someone approves layering it on", () => {
    const d = donor({ quotesSmall: cite(5) });
    const before = effective(ROP, d);
    expect(before.values.quotesSmall).toBe(3);
    expect(before.gaps.map((l) => l.key)).toContain("quotesSmall");
    const after = effective(ROP, d, {}, { quotesSmall: { by: "u1", name: "Test Admin", at: "2026-11-01", reason: "Donor agreement" } });
    expect(after.values.quotesSmall).toBe(5);
    expect(after.gaps.map((l) => l.key)).not.toContain("quotesSmall");
  });
  it("a looser donor rule never loosens ROP's", () => {
    const e = effective(ROP, donor({ quotesSmall: cite(1), microMaxUsd: cite(2000) }));
    expect(e.values.quotesSmall).toBe(3);
    expect(e.values.microMaxUsd).toBe(500);
    expect(e.gaps).toEqual([]);
  });
  it("a donor asking for a second person is a gap until approved", () => {
    const e = effective(ROP, donor({ secondPersonRequired: cite(true) }));
    expect(e.gaps.map((l) => l.key)).toContain("secondPersonRequired");
  });
  it("an advertising period longer than the longest bid period is a conflict", () => {
    const e = effective(ROP, donor({ advertisingDays: cite(45) }), {}, { advertisingDays: { by: "u1", name: "Test Admin", at: "2026-11-01", reason: "Donor agreement" } });
    expect(e.open.map((l) => l.key)).toContain("bidPeriodMaxDays");
  });
});

describe("show: a value in plain form", () => {
  it("formats money, lists, yes and no, and nothing", () => {
    expect(show(paramByKey.microMaxUsd, 500)).toBe("$500");
    expect(show(paramByKey.mileageRateUsd, 0.7)).toBe("$0.70");
    expect(show(paramByKey.screeningLists, [])).toBe("None");
    expect(show(paramByKey.committeeForBestValue, true)).toBe("Yes");
    expect(show(paramByKey.donorApprovalAboveUsd, null)).toBe("—");
  });
});
