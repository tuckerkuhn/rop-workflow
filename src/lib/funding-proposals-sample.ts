import { standardItems, type FundingProposal, type Item } from "@/lib/funding-proposals";

/**
 * One fictional proposal for the demo, a week from its deadline, so every part of the screen has
 * something to show: decisions open, a budget over the call's limits, sections rated and not,
 * one AI suggestion waiting for a reviewer, two staff contributors from outside the core and one
 * consultant from outside the organization. The donor, the call, the figures and the people are
 * invented.
 */
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function sampleProposal(today: string): FundingProposal {
  const set: Record<string, Partial<Item>> = {
    "Who applies: alone or with partners": { owner: "marcus", status: "final", due: plus(today, -3) },
    "Who the donor writes to with questions": { owner: "marcus", due: plus(today, 1) },
    "Context and the problem": { ref: "Section 1", owner: "karim", status: "final", points: 10, final: "13.01", rating: { band: "competitive", why: "Uses our own baseline from the two districts with dates and sample sizes. It answers the grid, but nothing in it is something another applicant could not also say.", next: "Add what the last project there showed did not work, and what we changed.", by: "marcus", byName: "Marcus Bell", at: plus(today, -1), suggested: false } },
    "Approach and activities": { ref: "Section 2", owner: "farid", status: "review", points: 30, working: "01.02", final: "13.01", due: plus(today, 2), rating: { band: "fringe", why: "The activities are listed and numbered, but the draft does not say why they would raise farm income, and gives no result from an earlier project.", next: "One line of logic per activity, with the yield and price change measured in the last orchard project.", by: "marcus", byName: "Marcus Bell", at: today, suggested: true } },
    "Results and how they are measured": { ref: "Section 3", owner: "karim", status: "drafting", points: 15, final: "13.01", due: plus(today, 2) },
    "Experience and capacity": { ref: "Section 4", owner: "marcus", status: "final", points: 20, final: "13.01", rating: { band: "differentiator", why: "Three comparable projects with results against targets and a reference each, and unbroken presence in the province. Few applicants can show this.", next: "", by: "karim", byName: "Karim Ahmadi", at: plus(today, -1), suggested: false } },
    "Team and management": { ref: "Section 5", owner: "karim", status: "drafting", points: 10, final: "13.01", due: plus(today, 3) },
    "Sustainability and exit": { ref: "Section 6", owner: "farid", status: "todo", points: 10, final: "13.01", due: plus(today, 3) },
    "Budget narrative and value for money": { ref: "Section 7", owner: "OUT-SAMPLE", status: "todo", points: 5, final: "13.01", due: plus(today, 3) },
    Budget: { ref: "Annex III", owner: "peter", status: "drafting", working: "04.02", final: "04.03", due: plus(today, 2) },
    "Results framework": { ref: "Annex IV", owner: "karim", status: "drafting", working: "05.02", final: "13.04", due: plus(today, 3) },
    Workplan: { ref: "Annex V", owner: "nadia", status: "drafting", working: "06.02", final: "13.05", due: plus(today, 3) },
    "Risk analysis": { ref: "Annex VII", owner: "nadia", signer: "marcus", status: "sign", working: "08.02", final: "13.07", due: plus(today, 4) },
    "Environmental and social checklist": { ref: "Annex VI", owner: "karim", signer: "marcus", status: "review", working: "07.03", final: "13.06", due: plus(today, 4) },
    "Safeguarding declaration and policy": { ref: "Annex II", owner: "marcus", status: "final", final: "13.03" },
    Declarations: { ref: "Annex I", owner: "peter", signer: "marcus", status: "sign", working: "02.02", final: "13.02", due: plus(today, 1) },
    "Registration and incorporation": { owner: "peter", status: "final", final: "13.10" },
    "Audited accounts": { owner: "peter", status: "final", final: "13.11" },
    "CVs of key staff": { owner: "karim", status: "drafting", final: "13.14", due: plus(today, 4) },
    "Upload and submit": { owner: "marcus", due: plus(today, 5), final: "13.99" },
  };
  const items = standardItems().map((i) => ({ ...i, ...(set[i.title] ?? {}) }));
  const deadline = `${plus(today, 6)}T23:59`;
  return {
    id: "PRO-SAMPLE",
    opportunityId: null,
    title: "Orchard Value Chains Recovery (fictional call)",
    donor: "Demo Development Facility (fictional)",
    portal: "",
    folder: "",
    currency: "USD",
    deadline: { at: deadline, zone: "Asia/Kabul" },
    targets: [
      { label: "Final files in the submission folder", at: `${plus(today, 6)}T12:00` },
      { label: "Submit", at: `${plus(today, 6)}T16:00` },
    ],
    themes: ["Twenty years of unbroken presence in the province, with staff already in place", "Farm income measured farmer by farmer, with every figure traceable to its record", "Buyers signed before planting, so the market pulls the crop"],
    rules: ["Edit files in the shared folder, not in downloaded copies.", "Save each final, signed file in the submission folder; old versions go to the archive folder, never deleted.", "Update your status here when a file changes hands."],
    budget: { ceiling: 2_000_000, total: 2_004_300, direct: 1_870_000, support: 371_000, indirect: 134_300, supportCap: 15, indirectCap: 7 },
    team: ["nadia", "farid"],
    outside: [{ id: "OUT-SAMPLE", name: "Lucía Barrios", org: "Budget consultant (fictional)", email: "" }],
    items,
    outcome: "drafting",
    confirmation: "",
    history: [{ at: plus(today, -5), by: "marcus", byName: "Marcus Bell", what: "Started from the standard list" }],
  };
}
