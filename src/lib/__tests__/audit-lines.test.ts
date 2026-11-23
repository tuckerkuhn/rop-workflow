import { describe, expect, it } from "vitest";
import { describeAudit, mayViewAudit } from "@/lib/audit";
import { users } from "@/lib/demo";
import { acrossProjectsFor, onProposals, opensProposals, orgAreasFor, registerProposalAccess } from "@/lib/org-areas";

const person = (id: string) => users.find((u) => u.id === id)!;

describe("audit trail lines", () => {
  it("says who a distribution was for, and what approving it made", () => {
    expect(describeAudit("distribution", "distribution_approved", { by: "nadia", farmer: "F-0002", target: "1.2.a" })).toBe("Approved the input distribution to farmer F-0002; one result made for target 1.2.a, waiting for MEL");
    expect(describeAudit("distribution", "distribution_recorded", { farmer: "F-0002", recordedBy: "Bilal Haidari", flags: [], emailed: true })).toBe("Recorded an input distribution to farmer F-0002 (recorded by Bilal Haidari); approver emailed");
    expect(describeAudit("distribution", "distribution_sent_back", { farmer: "F-0003", note: "Signature missing" })).toBe("Sent back the input distribution to farmer F-0003: Signature missing");
  });
  it("names the report a donor link opens", () => {
    expect(describeAudit("share", "share_viewed", { quarter: "2026-Q3", token: "ab12cd" })).toBe("The 2026-Q3 report was opened from its donor link (link ab12cd…)");
  });
  it("reads as words, with the entry's facts, when an entry has no line of its own", () => {
    expect(describeAudit("kobo", "kobo_reconciled", {})).toBe("Kobo reconciled");
    expect(describeAudit("donor", "donor_added", { name: "Demo Foundation", by: "marcus" })).toBe("Donor added (name Demo Foundation)");
    expect(describeAudit("plan", "plan_item_approved", { key: "P-3" })).toBe("Procurement calendar: item approved P-3");
  });
  it("opens for the people who sign off or review, never for a donor", () => {
    expect(mayViewAudit(person("marcus"))).toBe(true);
    expect(mayViewAudit(person("farida"))).toBe(false);
    expect(mayViewAudit(person("elena"))).toBe(false);
  });
});

describe("what is listed under Organization and what under Projects", () => {
  const holdsNothing = () => false;
  it("lists the portfolio and opportunities under Projects for an administrator, not under Organization", () => {
    const across = acrossProjectsFor(person("marcus"), holdsNothing).map((a) => a.id);
    expect(across).toEqual(["portfolio", "opportunities"]);
    const org = orgAreasFor(person("marcus"), holdsNothing).map((a) => a.id);
    expect(org).not.toContain("portfolio");
    expect(org).not.toContain("opportunities");
    expect(org).not.toContain("proposals");
    expect(org).toContain("settings");
  });
  it("opens neither for a donor", () => {
    expect(acrossProjectsFor(person("elena"), holdsNothing)).toEqual([]);
    expect(orgAreasFor(person("elena"), holdsNothing)).toEqual([]);
  });
});

describe("Proposals in the menu", () => {
  it("is listed for someone on a proposal's team, who still cannot start one", () => {
    registerProposalAccess({ tucker: "core", nadia: "team" });
    try {
      expect(acrossProjectsFor(person("nadia"), () => false).map((a) => a.id)).toEqual(["proposals"]);
      expect(onProposals(person("nadia"))).toBe(true);
      expect(opensProposals(person("nadia"))).toBe(false);
      expect(opensProposals(person("tucker"))).toBe(true);
      expect(acrossProjectsFor(person("farida"), () => false)).toEqual([]);
    } finally {
      registerProposalAccess(null);
    }
  });
});
