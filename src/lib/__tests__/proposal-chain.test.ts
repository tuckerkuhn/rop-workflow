import { describe, expect, it } from "vitest";
import { opportunityChain, type OppProposal } from "@/lib/opportunities";
import { decidedLead, NO_BUDGET, type FundingProposal } from "@/lib/funding-proposals";
import { formatById } from "@/lib/report-formats";
import { translate } from "@/lib/i18n";

/** The chain from a call to a project: each step links to the next; a decided proposal leads with its outcome. */

const won: OppProposal = { id: "PRP-1", opportunityId: "OPP-1", title: "Maize for Village B", outcome: "won", outcomeLabel: "Won", projectCode: "A-2027" };

describe("an opportunity links its proposal and its project", () => {
  it("names the proposal with its outcome and links it; the project link makes it the current one", () => {
    const c = opportunityChain({ id: "OPP-1", projectCode: "A-2027" }, [won]);
    expect(c.proposal).toEqual({ id: "PRP-1", label: "Proposal: Maize for Village B (Won)", href: "/work/proposals?open=PRP-1" });
    expect(c.project).toEqual({ code: "A-2027", label: "Project A-2027", href: "/project?project=A-2027" });
  });
  it("takes the project from the proposal when the opportunity has none; nothing shows when nothing followed", () => {
    expect(opportunityChain({ id: "OPP-1", projectCode: null }, [won]).project?.code).toBe("A-2027");
    expect(opportunityChain({ id: "OPP-2", projectCode: null }, [won])).toEqual({ proposal: null, project: null });
  });
  it("links a proposal still being written, without a project", () => {
    const c = opportunityChain({ id: "OPP-3", projectCode: null }, [{ id: "PRP-3", opportunityId: "OPP-3", title: "Grapes", outcome: "drafting", outcomeLabel: "In preparation" }]);
    expect(c.proposal?.label).toBe("Proposal: Grapes (In preparation)");
    expect(c.project).toBeNull();
  });
});

const prop = (over: Partial<FundingProposal>): FundingProposal => ({ id: "PRP-1", opportunityId: "OPP-1", title: "P", donor: "D", portal: "", folder: "", currency: "USD", deadline: null, targets: [], themes: [], rules: [], budget: { ...NO_BUDGET, ceiling: 346200 }, team: [], outside: [], items: [], outcome: "won", confirmation: "", history: [], ...over });

describe("a decided proposal leads with its outcome", () => {
  it("a won proposal set up as a project: the day, the award ceiling and the project", () => {
    const lead = decidedLead(prop({ decidedAt: "2026-07-27", projectCode: "A-2027" }), true);
    expect(lead).toEqual({ outcome: "won", headline: "Won on 27 July 2026", award: "Award ceiling: USD 346,200", project: { code: "A-2027", label: "Set up as A-2027", href: "/project?project=A-2027" }, setUpHref: null });
  });
  it("a won proposal not set up yet offers setup to someone who may set up projects only", () => {
    expect(decidedLead(prop({ decidedAt: "2026-07-27" }), true)?.setUpHref).toBe("/setup?new=1&proposal=PRP-1");
    expect(decidedLead(prop({ decidedAt: "2026-07-27" }), false)?.setUpHref).toBeNull();
  });
  it("not funded or withdrawn: the outcome and its day from the history, no award", () => {
    const lost = decidedLead(prop({ outcome: "lost", history: [{ at: "2026-05-02", by: "t", byName: "T", what: "Submitted" }, { at: "2026-08-14", by: "t", byName: "T", what: "Not funded" }] }), true);
    expect(lost).toMatchObject({ headline: "Not funded on 14 August 2026", award: null, project: null, setUpHref: null });
    expect(decidedLead(prop({ outcome: "withdrawn" }), true)?.headline).toBe("Withdrawn");
  });
  it("nothing to lead with while it is prepared or waits for the donor", () => {
    expect(decidedLead(prop({ outcome: "drafting" }), true)).toBeNull();
    expect(decidedLead(prop({ outcome: "submitted" }), true)).toBeNull();
  });
});

describe("the donor's reporting format", () => {
  it("shows the default as the standard format, not as a baseline survey; the stored value stays", () => {
    const f = formatById("baseline");
    expect(f.id).toBe("baseline");
    expect(translate("en", f.label)).toBe("Standard format");
    expect(translate("en", formatById(undefined).label)).toBe("Standard format");
  });
});
