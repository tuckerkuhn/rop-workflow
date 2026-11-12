import type { AppUser } from "@/lib/demo";
import { HR_ACCESS_ROLES, type HrRole } from "@/lib/hr";

/**
 * The Organization area: the parts of the app about running Roots of Peace rather than a
 * project's results. Each part opens only for the people whose role needs it; the pages and their
 * APIs check the same roles on the server. Every change in these parts is recorded (the HR ledger
 * for people and pay, the audit log for the rest), and the Organization audit page shows it.
 */

export type OrgArea = { id: string; href: string; title: string; help: string };

type Holds = (role: HrRole) => boolean;

const hr = (holds: Holds) => HR_ACCESS_ROLES.some(holds);
const lead = (u: AppUser, holds: Holds) => !!u.admin || (["ceo", "management", "cfo"] as HrRole[]).some(holds);

export const ORG_AREAS: (OrgArea & { allow: (u: AppUser, holds: Holds) => boolean })[] = [
  { id: "people", href: "/people", title: "People and HR record", help: "Staff records, contracts, approvals and the HR ledger.", allow: (_u, h) => hr(h) },
  { id: "payroll", href: "/payroll", title: "Payroll", help: "Monthly payroll, the ADP RUN file and the bank file.", allow: (_u, h) => (["payroll", "cfo", "ceo", "finance"] as HrRole[]).some(h) },
  { id: "onboarding", href: "/onboarding", title: "Starting and leaving", help: "Onboarding and offboarding steps.", allow: (_u, h) => hr(h) },
  { id: "plan", href: "/work/plan", title: "Procurement calendar", help: "Planned purchases and the requests made from them.", allow: (u) => u.procurementAccess !== "none" },
  { id: "procurements", href: "/work/procurements", title: "Large procurements", help: "Every large procurement in your projects, by step, with the ones waiting longest on top.", allow: (u) => u.procurementAccess !== "none" },
  { id: "suppliers", href: "/work/suppliers", title: "Suppliers", help: "The supplier register and its screening.", allow: (u) => u.procurementAccess !== "none" },
  { id: "bills", href: "/work/bills", title: "Bills", help: "Bills to approve and pay.", allow: (u, h) => u.procurementAccess !== "none" || (["bills", "finance", "cfo"] as HrRole[]).some(h) },
  { id: "opportunities", href: "/work/opportunities", title: "Opportunities", help: "New funding: framing, the match brief and the match call.", allow: (u, h) => lead(u, h) },
  { id: "portfolio", href: "/portfolio", title: "Portfolio", help: "Every project at a glance.", allow: (u, h) => lead(u, h) },
  { id: "settings", href: "/settings/organization", title: "Organization settings", help: "Policy, people's access and the organization's rules.", allow: (u) => !!u.admin },
  { id: "audit", href: "/organization/audit", title: "Organization audit log", help: "Every change in these areas: who, when and what.", allow: (u, h) => !!u.admin || hr(h) },
];

export const orgAreasFor = (u: AppUser | null, holds: Holds): OrgArea[] =>
  u && u.kind === "employee" ? ORG_AREAS.filter((a) => a.allow(u, holds)).map((a) => ({ id: a.id, href: a.href, title: a.title, help: a.help })) : [];
