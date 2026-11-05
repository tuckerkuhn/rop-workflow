import { z } from "zod";
import type { Access, FieldRole, Lang, ProcRole, ProjectRole } from "@/lib/demo";

/**
 * People and what they may do in the app, in plain words for the people screen. Approval roles
 * (who signs bills, payroll, procurement) are not here: they live in the HR authority table and
 * change only through a signed proposal.
 */

export const PROJECT_ROLES: { id: ProjectRole; label: string; help: string }[] = [
  { id: "plan-approver", label: "Approves plans", help: "Signs off project plans and setup changes; may write donor reports." },
  { id: "monthly-review", label: "Monthly review", help: "Reviews each month's progress; may write donor reports." },
  { id: "report-release", label: "Releases donor reports", help: "Marks a donor report final. Nobody can change it after that." },
  { id: "mel-owner", label: "MEL owner", help: "Accepts or queries the results field staff record; may write donor reports." },
  { id: "finance-import", label: "Imports spending", help: "Imports Finance's monthly budget-against-actual workbook." },
];

export const FIELD_ROLES: { id: FieldRole; label: string }[] = [
  { id: "extension", label: "Extension officer" },
  { id: "mel", label: "MEL officer" },
  { id: "store", label: "Storekeeper" },
  { id: "manager", label: "Field manager" },
];

export const PROC_ROLES: { id: ProcRole; label: string }[] = [
  { id: "holder", label: "Budget holder (requests purchases)" },
  { id: "procurement", label: "Procurement officer" },
  { id: "committee", label: "Evaluation committee" },
  { id: "ho", label: "Home Office review" },
  { id: "approver", label: "Approves purchases" },
  { id: "finance", label: "Finance (vouchers and payment)" },
];

export const ACCESS_LABEL: Record<Access, string> = { edit: "Records and edits", view: "Sees only", none: "No access" };
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fa", label: "Dari" },
  { id: "ps", label: "Pashto" },
  { id: "es", label: "Español" },
];

const roleIds = <T extends string>(l: { id: T }[]) => l.map((x) => x.id) as [T, ...T[]];

/** Everything about a person the people screen can change. */
export const personSchema = z.object({
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200).nullable(),
  kind: z.enum(["employee", "donor"]),
  org: z.string().trim().min(2).max(120),
  reportsTo: z.string().max(60).nullable(),
  lang: z.enum(roleIds(LANGS)),
  project: z.array(z.enum(roleIds(PROJECT_ROLES))),
  field: z.array(z.enum(roleIds(FIELD_ROLES))),
  fieldAccess: z.enum(["edit", "view", "none"]),
  procurement: z.array(z.enum(roleIds(PROC_ROLES))),
  procurementAccess: z.enum(["edit", "view", "none"]),
  pii: z.boolean(),
  admin: z.boolean(),
  /** Workplan activity numbers this person leads ("1.1", "2.1.2"), or "operations". */
  leads: z.array(z.string().trim().regex(/^(\d+(\.\d+)*|operations)$/)).max(30),
});
export type PersonInput = z.infer<typeof personSchema>;

export const staffActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), person: personSchema }),
  z.object({ action: z.literal("update"), id: z.string().min(1).max(60), person: personSchema }),
  z.object({ action: z.literal("active"), id: z.string().min(1).max(60), active: z.boolean() }),
  z.object({ action: z.literal("account"), id: z.string().min(1).max(60) }),
]);
export type StaffAction = z.infer<typeof staffActionSchema>;

/** What changed between two versions of a person, in words, for the change log. */
export function describeChange(before: PersonInput | null, after: PersonInput): string[] {
  if (!before) return ["Added"];
  const out: string[] = [];
  const list = (k: "project" | "field" | "procurement", labels: { id: string; label: string }[], what: string) => {
    const name = (id: string) => labels.find((l) => l.id === id)?.label ?? id;
    const added = after[k].filter((x) => !(before[k] as string[]).includes(x));
    const removed = (before[k] as string[]).filter((x) => !(after[k] as string[]).includes(x));
    if (added.length) out.push(`${what}: gave ${added.map(name).join(", ")}`);
    if (removed.length) out.push(`${what}: took away ${removed.map(name).join(", ")}`);
  };
  list("project", PROJECT_ROLES, "Project roles");
  list("field", FIELD_ROLES, "Field roles");
  list("procurement", PROC_ROLES, "Procurement roles");
  const simple: [keyof PersonInput, string][] = [
    ["name", "Name"],
    ["title", "Title"],
    ["email", "Email"],
    ["kind", "Staff or donor"],
    ["org", "Organization"],
    ["reportsTo", "Reports to"],
    ["lang", "Language"],
    ["fieldAccess", "Field access"],
    ["procurementAccess", "Procurement access"],
    ["pii", "Sees participant names"],
    ["admin", "Administrator"],
  ];
  for (const [k, label] of simple) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(`${label}: ${String(before[k] ?? "none")} → ${String(after[k] ?? "none")}`);
  if (before.leads.join(",") !== after.leads.join(",")) out.push(`Leads: ${before.leads.join(", ") || "none"} → ${after.leads.join(", ") || "none"}`);
  return out;
}

/** Changes a person may not make to their own record: another administrator must. */
export function selfChangeProblem(before: PersonInput, after: PersonInput): string | null {
  const locked: (keyof PersonInput)[] = ["project", "field", "procurement", "fieldAccess", "procurementAccess", "pii", "admin", "kind", "org", "email", "reportsTo"];
  const changed = locked.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return changed.length ? "You cannot change your own roles, access or email: ask another administrator. You can change your own name, title and language." : null;
}
