/**
 * Demo people, projects, currency and work-time history.
 * Everything here is fictional and exists only to drive the prototype.
 */

export type FieldRole = "extension" | "mel" | "store" | "manager";
export type ProcRole = "holder" | "procurement" | "committee" | "ho" | "approver" | "finance";
/** Project-level sign-offs and jobs from the build spec. */
export type ProjectRole = "plan-approver" | "monthly-review" | "report-release" | "mel-owner" | "finance-import";
export type Access = "edit" | "view" | "none";
export type Lang = "en" | "es" | "fa" | "ps";

/** Every record carries an organization ID from day one (build spec). ROP only in the pilot. */
export const ORG_ID = "rop";

export type AppUser = {
  id: string;
  name: string;
  title: string;
  kind: "employee" | "donor";
  org: string;
  /** Line manager's user id. Managers see their direct reports' work. */
  reportsTo?: string;
  field: FieldRole[];
  procurement: ProcRole[];
  project: ProjectRole[];
  fieldAccess: Access;
  procurementAccess: Access;
  /** May see participant names. Everyone else, and every AI agent, sees farmer IDs only. */
  pii: boolean;
  lang: Lang;
  /** Average of farmer feedback about this person, where collected. */
  feedback?: { score: number; n: number };
};

const ROP = "Roots of Peace";
export const users: AppUser[] = [
  { id: "tucker", name: "Tucker Kuhn", title: "Pilot lead", kind: "employee", org: ROP, field: [], procurement: [], project: ["plan-approver", "monthly-review", "report-release"], fieldAccess: "view", procurementAccess: "view", pii: false, lang: "en" },
  { id: "daniel", name: "Daniel Sandoval", title: "Director of Global Operations", kind: "employee", org: ROP, reportsTo: "tucker", field: [], procurement: [], project: ["plan-approver", "monthly-review", "finance-import"], fieldAccess: "view", procurementAccess: "view", pii: false, lang: "en" },
  { id: "karim", name: "Karim Ahmadi", title: "Country director", kind: "employee", org: ROP, reportsTo: "daniel", field: [], procurement: ["approver"], project: [], fieldAccess: "view", procurementAccess: "edit", pii: false, lang: "fa" },
  { id: "sarah", name: "Sarah Lee", title: "Compliance reviewer, Home Office", kind: "employee", org: ROP, reportsTo: "daniel", field: [], procurement: ["ho"], project: [], fieldAccess: "view", procurementAccess: "edit", pii: false, lang: "en" },
  { id: "nadia", name: "Nadia Rahimi", title: "Project manager", kind: "employee", org: ROP, reportsTo: "karim", field: ["manager"], procurement: ["holder"], project: [], fieldAccess: "edit", procurementAccess: "edit", pii: true, lang: "fa", feedback: { score: 4.6, n: 12 } },
  { id: "zahra", name: "Zahra Karimi", title: "Procurement officer", kind: "employee", org: ROP, reportsTo: "karim", field: [], procurement: ["procurement"], project: [], fieldAccess: "view", procurementAccess: "edit", pii: false, lang: "fa" },
  { id: "yusuf", name: "Yusuf Mohammadi", title: "Finance officer", kind: "employee", org: ROP, reportsTo: "karim", field: [], procurement: ["finance"], project: ["finance-import"], fieldAccess: "view", procurementAccess: "edit", pii: false, lang: "ps" },
  { id: "farida", name: "Farida Noori", title: "Extension agent", kind: "employee", org: ROP, reportsTo: "nadia", field: ["extension"], procurement: [], project: [], fieldAccess: "edit", procurementAccess: "none", pii: true, lang: "fa", feedback: { score: 4.7, n: 38 } },
  { id: "omar", name: "Omar Sadiq", title: "MEL officer", kind: "employee", org: ROP, reportsTo: "nadia", field: ["mel"], procurement: [], project: ["mel-owner"], fieldAccess: "edit", procurementAccess: "none", pii: true, lang: "ps", feedback: { score: 4.4, n: 26 } },
  { id: "bilal", name: "Bilal Haidari", title: "Storekeeper", kind: "employee", org: ROP, reportsTo: "nadia", field: ["store"], procurement: ["committee"], project: [], fieldAccess: "edit", procurementAccess: "edit", pii: true, lang: "fa", feedback: { score: 4.2, n: 31 } },
  { id: "elena", name: "Elena Marsh", title: "Program officer", kind: "donor", org: "Demo Foundation (fictional)", field: [], procurement: [], project: [], fieldAccess: "view", procurementAccess: "none", pii: false, lang: "en" },
];

export const langLabel: Record<Lang, string> = { en: "English", es: "Español", fa: "دری · Dari", ps: "پښتو · Pashto" };

export const userById = (id: string) => users.find((u) => u.id === id);
export const holderOf = (workspace: "field" | "procurement", role: string) =>
  users.find((u) => (workspace === "field" ? (u.field as string[]) : (u.procurement as string[])).includes(role));
export const projectRoleHolders = (r: ProjectRole) => users.filter((u) => u.project.includes(r));
export const directReports = (id: string) => users.filter((u) => u.reportsTo === id);
export const canSeePII = (u: AppUser | null | undefined) => !!u?.pii;

export const PROJECT = {
  id: "A-2027",
  name: "Village B Smallholder Maize",
  country: "Afghanistan",
  season: "2027 Spring",
  award: "Award A-2027 (fictional)",
};

export type Stage = "Develop" | "Design" | "Execute" | "Verify" | "Report";
export const STAGES: Stage[] = ["Develop", "Design", "Execute", "Verify", "Report"];

export const projects = [
  {
    ...PROJECT,
    orgId: ORG_ID,
    status: "Active",
    stage: "Execute" as Stage,
    note: "Fictional demo project. Runs the full thin path: design, approve, implement, measure, report.",
    workflows: ["field", "procurement"] as const,
  },
  {
    id: "WH",
    name: "Western Highlands",
    country: "Guatemala",
    season: "Restart pending",
    award: "Donor template not chosen yet",
    orgId: ORG_ID,
    status: "Paused",
    stage: "Design" as Stage,
    note: "Pilot project in the build spec. Its plan, results and field data are not loaded yet, so nothing here is filled in.",
    workflows: [] as const,
  },
];

/** Demo exchange rate. Stands in for the ROP monthly rate kept in NetSuite. */
export const AFN_PER_USD = 70;
export type Currency = "USD" | "AFN";

export function formatMoney(usd: number, currency: Currency) {
  if (currency === "AFN") return `Afs ${Math.round(usd * AFN_PER_USD).toLocaleString("en-US")}`;
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: usd < 100 ? 2 : 0 })}`;
}

/* ---------- projections from past work ---------- */

/** Median days each step took in past (synthetic) cases, with the number of cases. */
export const stepHistory: Record<string, { median: number; n: number }> = {
  // procurement
  need: { median: 2, n: 31 },
  requisition: { median: 3, n: 31 },
  approveReq: { median: 2, n: 29 },
  quotes: { median: 6, n: 18 },
  solicitation: { median: 4, n: 12 },
  hoReview: { median: 3, n: 9 },
  approveSol: { median: 2, n: 12 },
  bids: { median: 14, n: 12 },
  evaluate: { median: 4, n: 11 },
  screen: { median: 2, n: 11 },
  approveAward: { median: 2, n: 27 },
  contract: { median: 4, n: 25 },
  sign: { median: 2, n: 25 },
  receive: { median: 18, n: 24 },
  payReady: { median: 5, n: 22 },
  close: { median: 10, n: 15 },
  // field activities
  train: { median: 7, n: 64 },
  prepare: { median: 10, n: 60 },
  verify: { median: 2, n: 58 },
  correct: { median: 5, n: 9 },
  removal: { median: 2, n: 3 },
  distribute: { median: 3, n: 52 },
  plant: { median: 6, n: 50 },
  validate: { median: 3, n: 14 },
  decide: { median: 4, n: 14 },
  act: { median: 7, n: 11 },
};

export type ProjectedStep = { step: string; owner: string; start: string; end: string };

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * Projects when each remaining step starts and ends, from the median durations above.
 * The current step's remaining time is its median minus time already spent (at least one day).
 */
export function projectPath(path: { step: string; owner: string }[], currentSince: string, today: string): ProjectedStep[] {
  let cursor = today;
  return path.map((p, i) => {
    const med = stepHistory[p.step]?.median ?? 3;
    const left = i === 0 ? Math.max(1, med - daysBetween(currentSince, today)) : med;
    const start = cursor;
    cursor = addDays(cursor, left);
    return { ...p, start, end: cursor };
  });
}

export const daysFrom = (today: string, d: string) => daysBetween(today, d);
