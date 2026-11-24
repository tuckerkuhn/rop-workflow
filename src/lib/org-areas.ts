import type { AppUser } from "@/lib/demo";
import { HR_ACCESS_ROLES, type HrRole } from "@/lib/hr";

/**
 * The Organization area: the parts of the app about running Roots of Peace rather than a
 * project's results. Each part opens only for the people whose role needs it; the pages and their
 * APIs check the same roles on the server. Every change in these parts is recorded (the HR ledger
 * for people and pay, the audit log for the rest), and the Organization audit page shows it.
 */

export type OrgArea = { id: string; href: string; title: string; help: string };

/**
 * Who is in the organization's core for Proposals, by person id (lib/funding-proposals inCore),
 * and who is on a proposal's team without being in the core. The core is an organization setting
 * the browser does not hold, so the session loads it once and registers it here. The API checks
 * again on every request.
 */
let proposalAccess: Record<string, "core" | "team"> = {};
export function registerProposalAccess(m: Record<string, "core" | "team"> | null | undefined) {
  proposalAccess = m ?? {};
}
/** In the core: may start a proposal, and sees and runs every one. */
export const opensProposals = (u: AppUser | null) => !!u && proposalAccess[u.id] === "core";
/** Has a proposal to open: the core, and anyone added to one (who then sees that one only). The menu lists Proposals for both. */
export const onProposals = (u: AppUser | null) => !!u && !!proposalAccess[u.id];

type Holds = (role: HrRole) => boolean;

const hr = (holds: Holds) => HR_ACCESS_ROLES.some(holds);
const lead = (u: AppUser, holds: Holds) => !!u.admin || (["ceo", "management", "cfo"] as HrRole[]).some(holds);

export const ORG_AREAS: (OrgArea & { allow: (u: AppUser, holds: Holds) => boolean })[] = [
  // The organization's reference shelf, for all staff: it is what opens Organization to everyone.
  { id: "resources", href: "/resources", title: "Resources", help: "Guides, policies and forms to read.", allow: (u) => u.kind === "employee" },
  { id: "people", href: "/people", title: "People and HR record", help: "Staff records, contracts, approvals and the HR ledger.", allow: (_u, h) => hr(h) },
  { id: "payroll", href: "/payroll", title: "Payroll", help: "Monthly payroll, the ADP RUN file and the bank file.", allow: (_u, h) => (["payroll", "cfo", "ceo", "finance"] as HrRole[]).some(h) },
  { id: "onboarding", href: "/onboarding", title: "Starting at ROP, leaving and renewals", help: "Onboarding and offboarding steps.", allow: (_u, h) => hr(h) },
  { id: "training", href: "/training", title: "Training log", help: "Who is due an induction or a yearly refresher, each training with its proof, and the year's priorities.", allow: (u, h) => hr(h) || lead(u, h) },
  { id: "plan", href: "/work/plan", title: "Procurement calendar", help: "Planned purchases and the requests made from them.", allow: (u) => u.procurementAccess !== "none" },
  { id: "procurements", href: "/work/procurements", title: "Large purchases across your projects", help: "Every large purchase in all your projects, by step, with the ones waiting longest on top. One project's purchases are under Projects → Procurement.", allow: (u) => u.procurementAccess !== "none" },
  { id: "suppliers", href: "/work/suppliers", title: "Suppliers", help: "The supplier register and its screening.", allow: (u) => u.procurementAccess !== "none" },
  { id: "bills", href: "/work/bills", title: "Bills", help: "Bills to approve and pay.", allow: (u, h) => u.procurementAccess !== "none" || (["bills", "finance", "cfo"] as HrRole[]).some(h) },
  { id: "opportunities", href: "/work/opportunities", title: "Opportunities", help: "New funding: framing, the match brief and the match call.", allow: (u, h) => lead(u, h) },
  { id: "proposals", href: "/work/proposals", title: "Proposals", help: "From a matched opportunity to submitted: what the call requires, who owns each item and how it would score.", allow: (u) => onProposals(u) },
  { id: "portfolio", href: "/portfolio", title: "All projects", help: "Every project at a glance.", allow: (u, h) => lead(u, h) },
  { id: "settings", href: "/settings/organization", title: "Organization settings", help: "Policy, people's access and the organization's rules.", allow: (u) => !!u.admin },
  { id: "audit", href: "/organization/audit", title: "Organization audit log", help: "Every change in these areas: who, when and what.", allow: (u, h) => !!u.admin || hr(h) },
];

/**
 * Where projects come from and how they compare (the portfolio, opportunities, proposals) is
 * listed under Projects, not Organization. The same roles open each part, and their changes are
 * still in the Organization audit log.
 */
const ACROSS_PROJECTS = ["portfolio", "opportunities", "proposals"];

const areasFor = (u: AppUser | null, holds: Holds): OrgArea[] =>
  u && u.kind === "employee" ? ORG_AREAS.filter((a) => a.allow(u, holds)).map((a) => ({ id: a.id, href: a.href, title: a.title, help: a.help })) : [];

/** The Organization area's parts this person's role opens. */
export const orgAreasFor = (u: AppUser | null, holds: Holds): OrgArea[] => areasFor(u, holds).filter((a) => !ACROSS_PROJECTS.includes(a.id));

/**
 * True when Resources is the only part of Organization this person's role opens. The menu then
 * calls the tab "Resources" and opens /resources directly, rather than a page with one card. The
 * Organization page itself stays as it is and can still be opened by its address.
 */
export const onlyResources = (areas: OrgArea[]) => areas.length === 1 && areas[0].id === "resources";

/** The parts across projects this person's role opens, in the order Projects lists them. */
export const acrossProjectsFor = (u: AppUser | null, holds: Holds): OrgArea[] => {
  const mine = areasFor(u, holds);
  return ACROSS_PROJECTS.flatMap((id) => mine.filter((a) => a.id === id));
};
