/**
 * The project spine from the build spec (docs/ROP-PROJECT-HARNESS-BUILD-SPEC-v1.md):
 * Activity → Indicator → Target → Actual → Evidence, with approvals, agent runs and an audit trail.
 * Everything here is fictional demo data for project A-2027.
 */

import { TODAY } from "@/components/workspace/ui";
import { ORG_ID, PROJECT, userById } from "@/lib/demo";
import { seedField, type Farmer, type FieldItem } from "@/lib/field";
import { DONE, budgetLines, seedProcurements, stepById, type Procurement } from "@/lib/procurement";

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/* ---------- results framework ---------- */

export type Level = "Goal" | "Outcome" | "Output";
export type Result = { id: string; level: Level; statement: string; parent?: string; donorRef?: string };

export const results: Result[] = [
  { id: "G", level: "Goal", statement: "Smallholder families in Village B earn more from maize, sustainably", donorRef: "PDO" },
  { id: "O1", level: "Outcome", statement: "Farmers adopt improved maize practices", parent: "G", donorRef: "Intermediate result 1" },
  { id: "O1.1", level: "Output", statement: "Farmers trained in improved land preparation and planting", parent: "O1", donorRef: "Component 1.1" },
  { id: "O1.2", level: "Output", statement: "Farmers equipped with quality inputs", parent: "O1", donorRef: "Component 1.2" },
  { id: "O1.3", level: "Output", statement: "Farmers linked to buyers", parent: "O1", donorRef: "Component 2.1" },
];

/* ---------- activities: ROP's standard field sequence, as an editable template ---------- */

export type ActivityStatus = "Done" | "In progress" | "Not started" | "Late";
export type Activity = { n: number; name: string; output?: string; owner: string; start: string; end: string; budgetLines: string[] };

export const activities: Activity[] = [
  { n: 1, name: "Staff recruited and onboarded", owner: "nadia", start: "2026-10-01", end: "2026-10-31", budgetLines: ["1.1"] },
  { n: 2, name: "Farmers recruited", owner: "farida", start: "2026-10-15", end: "2026-11-30", budgetLines: [] },
  { n: 3, name: "Training of trainers", output: "O1.1", owner: "nadia", start: "2026-12-01", end: "2027-01-15", budgetLines: ["4.1"] },
  { n: 4, name: "Farmer trainings", output: "O1.1", owner: "farida", start: "2027-01-20", end: "2027-03-10", budgetLines: ["4.1"] },
  { n: 5, name: "Farm input package procurement", output: "O1.2", owner: "zahra", start: "2027-01-10", end: "2027-03-20", budgetLines: ["2.1", "2.2", "2.3", "2.4", "2.5"] },
  { n: 6, name: "Farm input package distribution", output: "O1.2", owner: "bilal", start: "2027-02-15", end: "2027-03-25", budgetLines: [] },
  { n: 7, name: "Farm visits", output: "O1.1", owner: "omar", start: "2027-02-01", end: "2027-08-31", budgetLines: [] },
  { n: 8, name: "Follow-on farmer trainings", output: "O1.1", owner: "farida", start: "2027-04-01", end: "2027-07-31", budgetLines: ["4.1"] },
  { n: 9, name: "Agribusiness support", output: "O1.3", owner: "nadia", start: "2027-06-01", end: "2027-10-31", budgetLines: [] },
  { n: 10, name: "Marketing support", output: "O1.3", owner: "nadia", start: "2027-08-01", end: "2027-11-30", budgetLines: [] },
];

export const CROSS_CUTTING = ["MEL", "Budget", "Expense", "Payment", "Compliance", "Donor reporting", "Org comms", "HR support"];

/** Status from the live workflow records where they exist, otherwise from the plan dates. */
export function activityStatus(a: Activity, field: FieldItem[], procs: Procurement[]): { status: ActivityStatus; detail: string } {
  const farmers = field.filter((i): i is Farmer => i.kind === "farmer" && i.step !== "removed");
  const past = (steps: string[]) => farmers.filter((f) => !steps.includes(f.step)).length;
  const byDate = (): { status: ActivityStatus; detail: string } =>
    TODAY > a.end ? { status: "Done", detail: `Planned ${a.start} to ${a.end}` } : TODAY < a.start ? { status: "Not started", detail: `Starts ${a.start}` } : { status: "In progress", detail: `Until ${a.end}` };
  switch (a.n) {
    case 2:
      return { status: "Done", detail: `${farmers.length} farmers enrolled` };
    case 4: {
      const n = past(["train"]);
      return { status: n === farmers.length ? "Done" : TODAY > a.end ? "Late" : "In progress", detail: `${n} of ${farmers.length} trained · from Field activities` };
    }
    case 5: {
      const inputs = procs.filter((p) => ["2.1", "2.2"].includes(p.budgetLine));
      const received = inputs.filter((p) => p.step === DONE || ["payReady", "close"].includes(p.step)).length;
      const stuck = inputs.find((p) => p.step !== DONE && p.neededBy < TODAY);
      return {
        status: received === inputs.length ? "Done" : stuck ? "Late" : "In progress",
        detail: inputs.map((p) => `${p.id} ${p.step === DONE ? "closed" : stepById[p.step]?.title.toLowerCase()}`).join(" · "),
      };
    }
    case 6: {
      const n = farmers.filter((f) => ["plant", "complete"].includes(f.step)).length;
      return { status: TODAY > a.end && n < farmers.length ? "Late" : "In progress", detail: `${n} of ${farmers.length} packages distributed · from Field activities` };
    }
    default:
      return byDate();
  }
}

/* ---------- indicators and targets ---------- */

export type Theme = "Net income" | "Resilience" | "Environment" | "Equity";
export type Indicator = {
  id: string;
  result: string;
  name: string;
  unit: string;
  target: number;
  source: SubmissionForm | "survey";
  /** Counts distinct farmers with an accepted submission of this form, optionally filtered. */
  match?: (s: Submission) => boolean;
  frequency: string;
  library?: Theme;
  donorRef: string;
};

export const indicators: Indicator[] = [
  { id: "IND-1", result: "O1.1", name: "Farmers trained in land preparation", unit: "farmers", target: 20, source: "training", frequency: "Monthly", donorRef: "Core sector indicator 1.1.a" },
  { id: "IND-2", result: "O1.2", name: "Farmers receiving the input package", unit: "farmers", target: 20, source: "distribution", frequency: "Monthly", donorRef: "Core sector indicator 1.2.a" },
  {
    id: "IND-3",
    result: "O1",
    name: "Farmers meeting the land-preparation standard",
    unit: "farmers",
    target: 16,
    source: "readiness",
    match: (s) => s.fields.result === "Yes",
    frequency: "Monthly",
    donorRef: "IR 1 indicator a",
  },
  { id: "IND-4", result: "O1.1", name: "Farm visits completed", unit: "visits", target: 40, source: "visit", frequency: "Monthly", donorRef: "Component 1.1 process indicator" },
  { id: "IND-5", result: "G", name: "Change in net farm income", unit: "% vs baseline", target: 25, source: "survey", frequency: "End of season", library: "Net income", donorRef: "PDO indicator 1" },
];

export const indicatorLibrary: { theme: Theme; picked: boolean; example: string }[] = [
  { theme: "Net income", picked: true, example: "Change in net farm income vs baseline" },
  { theme: "Resilience", picked: false, example: "Households with a second income source" },
  { theme: "Environment", picked: false, example: "Hectares under soil-conserving practice" },
  { theme: "Equity", picked: false, example: "Share of benefits reaching women and youth" },
];

/* ---------- Kobo submissions and the review queue ---------- */

export type SubmissionForm = "training" | "readiness" | "distribution" | "visit";
export const formLabel: Record<SubmissionForm, string> = {
  training: "Training attendance",
  readiness: "Readiness visit",
  distribution: "Input distribution receipt",
  visit: "Farm visit",
};

export type Submission = {
  id: string;
  orgId: string;
  form: SubmissionForm;
  farmerId: string;
  date: string;
  enumerator: string;
  gps: [number, number];
  fields: Record<string, string>;
  photo: boolean;
  status: "pending" | "accepted" | "queried";
  decidedBy?: string;
  decidedOn?: string;
  note?: string;
};

/** Project area for the GPS check (fictional). */
export const AREA = { lat: [34.5, 34.6], lng: [69.1, 69.25] } as const;

/** Data checker agent: quality flags on one submission. */
export function dataFlags(s: Submission, all: Submission[]): string[] {
  const f: string[] = [];
  const dup = all.find((o) => o.id !== s.id && o.form === s.form && o.farmerId === s.farmerId && o.id < s.id && s.form !== "visit");
  if (dup) f.push(`Possible duplicate of ${dup.id} (same farmer, same form)`);
  const [lat, lng] = s.gps;
  if (lat < AREA.lat[0] || lat > AREA.lat[1] || lng < AREA.lng[0] || lng > AREA.lng[1]) f.push(`GPS ${lat.toFixed(3)}, ${lng.toFixed(3)} is outside the project area`);
  const missing = Object.entries(s.fields)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) f.push(`Missing: ${missing.join(", ")}`);
  if (s.form !== "visit" && !s.photo) f.push("No photo attached");
  return f;
}

export function seedSubmissions(field: FieldItem[] = seedField()): Submission[] {
  const out: Submission[] = [];
  let n = 100;
  const farmers = field.filter((i): i is Farmer => i.kind === "farmer");
  const add = (form: SubmissionForm, f: Farmer, date: string, fields: Record<string, string>, extra: Partial<Submission> = {}) => {
    n += 1;
    const pending = date >= addDays(TODAY, -6);
    out.push({
      id: `KB-${n}`,
      orgId: ORG_ID,
      form,
      farmerId: f.id,
      date,
      enumerator: form === "readiness" || form === "visit" ? "omar" : form === "distribution" ? "bilal" : "farida",
      gps: [34.55 + (n % 7) * 0.006, 69.17 + (n % 5) * 0.01],
      fields,
      photo: true,
      status: pending ? "pending" : "accepted",
      decidedBy: pending ? undefined : "omar",
      decidedOn: pending ? undefined : addDays(date, 2),
      ...extra,
    });
  };
  for (const f of farmers) {
    const done = (what: string) => f.timeline.find((e) => e.what.startsWith(what))?.date;
    const trained = done("Training recorded");
    if (trained) add("training", f, trained, { session: "Land preparation", gender: f.gender, age_band: f.ageBand, hh_size: String(f.householdSize) });
    const ready = f.timeline.find((e) => e.what.startsWith("Readiness: "));
    if (ready) add("readiness", f, ready.date, { result: ready.what.includes("Yes") ? "Yes" : "No", gender: f.gender });
    const dist = done("Inputs distributed");
    if (dist) add("distribution", f, dist, { seed_kg: "10", npk_kg: "50", signature: "Thumbprint", gender: f.gender });
    const planted = done("Planting recorded");
    if (planted) add("visit", f, planted, { purpose: "Planting follow-up", gender: f.gender });
  }
  // Fresh arrivals from today's Kobo pull, some with quality problems for the data checker.
  const byId = (id: string) => farmers.find((x) => x.id === id)!;
  add("training", byId("F-0004"), addDays(TODAY, -1), { session: "Land preparation", gender: "Male", age_band: "18–29 (youth)", hh_size: "4" });
  add("training", byId("F-0005"), addDays(TODAY, -1), { session: "Land preparation", gender: "Male", age_band: "18–29 (youth)", hh_size: "" });
  add("visit", byId("F-0007"), addDays(TODAY, -1), { purpose: "Pre-planting check", gender: "Female" }, { gps: [35.21, 69.18] });
  add("readiness", byId("F-0009"), TODAY, { result: "Yes", gender: "Female" }, { photo: false });
  add("visit", byId("F-0002"), TODAY, { purpose: "Germination check", gender: "Male" });
  add("visit", byId("F-0001"), addDays(TODAY, -2), { purpose: "Harvest planning", gender: "Male" });
  return out;
}

/** Draft Actual: distinct farmers (or visits) from accepted submissions. */
export function actualFor(ind: Indicator, subs: Submission[]) {
  if (ind.source === "survey") return { value: null as number | null, evidence: [] as Submission[], pending: 0, byGender: { Female: 0, Male: 0 } };
  const rel = subs.filter((s) => s.form === ind.source && (!ind.match || ind.match(s)));
  const accepted = rel.filter((s) => s.status === "accepted");
  const evidence = ind.unit === "visits" ? accepted : Object.values(Object.fromEntries(accepted.map((s) => [s.farmerId, s])));
  const byGender = { Female: 0, Male: 0 };
  evidence.forEach((s) => {
    const g = s.fields.gender as "Female" | "Male";
    if (g in byGender) byGender[g] += 1;
  });
  return { value: evidence.length, evidence, pending: rel.filter((s) => s.status === "pending").length, byGender };
}

/* ---------- budget and the NetSuite import ---------- */

export type PlanLine = { code: string; name: string; planned: number; plannedToDate: number };

export const planLines: PlanLine[] = [
  { code: "1.1", name: "Project staff", planned: 48000, plannedToDate: 20000 },
  ...budgetLines.map((b) => ({
    code: b.code,
    name: b.name,
    planned: { "2.1": 50000, "2.2": 64000, "2.3": 12000, "2.4": 30000, "2.5": 1500, "3.1": 40000 }[b.code] ?? b.remainingValue,
    plannedToDate: { "2.1": 20000, "2.2": 0, "2.3": 8000, "2.4": 4000, "2.5": 0, "3.1": 0 }[b.code] ?? 0,
  })),
  { code: "4.1", name: "Training costs", planned: 9000, plannedToDate: 5000 },
];

export type SpendRow = { ref: string; date: string; account: string; memo: string; amount: number; line: string };

/** What a NetSuite saved-search export looks like in this demo (fields are an open question in the spec). */
export const SAMPLE_EXPORT = `Document Number,Date,Account,Memo,Amount,Budget Line
VB-2027-0112,2027-01-31,6100 Salaries,January project staff,6800,1.1
VB-2027-0187,2027-02-28,6100 Salaries,February project staff,6800,1.1
VB-2027-0140,2027-02-05,6400 Training,ToT venue and meals,2100,4.1
VB-2027-0166,2027-02-19,6400 Training,Farmer training refreshments,1450,
VB-2027-0171,2027-02-21,5200 Program supplies,PR-2027-009 knapsack sprayers,7800,2.3
VB-2027-0175,2027-02-24,5200 Program supplies,PR-2027-011 OPV seed lot 1,18600,
VB-2027-0190,2027-03-01,5200 Program supplies,PR-2027-012 hermetic bags,3990,2.4
VB-2027-0193,2027-03-02,6900 Bank charges,Wire fees February,85,`;

export function parseExport(csv: string): SpendRow[] {
  const [, ...rows] = csv.trim().split(/\r?\n/);
  return rows
    .map((r) => r.split(","))
    .filter((c) => c.length >= 5)
    .map((c) => ({ ref: c[0], date: c[1], account: c[2], memo: c[3], amount: Number(c[4]) || 0, line: (c[5] ?? "").trim() }));
}

/** Finance mapper agent: suggests a budget line for an unmapped row, with its reasoning. */
export function suggestLine(r: SpendRow): { line: string; confidence: "High" | "Medium" | "Low"; why: string } | null {
  const m = r.memo.toLowerCase();
  if (m.includes("training") || r.account.startsWith("6400")) return { line: "4.1", confidence: "High", why: "Account 6400 Training maps to line 4.1 in every earlier month" };
  if (m.includes("seed")) return { line: "2.1", confidence: "High", why: "Memo names seed; procurement record sits on line 2.1" };
  if (m.includes("fee") || r.account.startsWith("6900")) return { line: "1.1", confidence: "Low", why: "Bank charges have no budget line; 1.1 is a guess. Ask Finance." };
  return null;
}

/* ---------- agents ---------- */

export type AgentJob = { name: string; stage: string; does: string; handsTo: string; inDemo: boolean };

export const agentJobs: AgentJob[] = [
  { name: "Match brief", stage: "Develop", does: "Summarizes opportunity, fit and key info for the match call", handsTo: "Tucker", inDemo: false },
  { name: "Proposal drafter", stage: "Design", does: "Drafts sections from template and past proposals", handsTo: "Proposal lead", inDemo: false },
  { name: "Lens reviewer", stage: "Design", does: "One pass per lens; returns gaps and suggested fixes", handsTo: "Lens owner", inDemo: false },
  { name: "Indicator advisor", stage: "Design", does: "Suggests indicators from library and donor set; drafts targets", handsTo: "MEL owner", inDemo: false },
  { name: "Procurement precheck", stage: "Execute", does: "Checks the package against ROP policy (shown as AI pre-checks in Procurement)", handsTo: "Daniel", inDemo: true },
  { name: "Task keeper", stage: "Execute", does: "Flags late work and projects who gets what next", handsTo: "Activity owner", inDemo: true },
  { name: "Data checker", stage: "Verify", does: "Rolls up Kobo data; flags duplicates, GPS, missing fields, photos", handsTo: "MEL owner", inDemo: true },
  { name: "Finance mapper", stage: "Verify", does: "Maps the NetSuite export to budget lines; flags variances", handsTo: "Daniel", inDemo: true },
  { name: "Monthly reviewer", stage: "Report", does: "Drafts the monthly review: targets, budget, risks, proposed changes", handsTo: "Tucker + Daniel", inDemo: true },
  { name: "Report writer", stage: "Report", does: "Assembles the ROP standard report and maps it to the donor template", handsTo: "Report approver", inDemo: true },
];

/* ---------- project state (approvals, decisions, audit) ---------- */

export type Approval = { what: string; by: string; date: string; note?: string };
export type AuditEvent = { date: string; who: string; what: string; kind: "create" | "change" | "approval" | "agent" | "import" };
export type ProposedChange = { id: string; text: string; status: "proposed" | "approved" | "declined"; by?: string };

export type ProjectState = {
  orgId: string;
  projectId: string;
  submissions: Submission[];
  /** Indicator id → MEL approval of the current period's Actual. */
  actualApprovals: Record<string, Approval>;
  spend: SpendRow[];
  importedOn?: string;
  varianceThreshold: number;
  changes: ProposedChange[];
  reportRelease?: Approval;
  planApproval: Approval;
  audit: AuditEvent[];
};

export function seedProject(): ProjectState {
  const submissions = seedSubmissions();
  return {
    orgId: ORG_ID,
    projectId: PROJECT.id,
    submissions,
    actualApprovals: {},
    spend: [],
    varianceThreshold: 10,
    changes: [
      { id: "C-1", text: "Move follow-on training (activity 8) to start after the planting window closes on 2027-03-20, so extension agents finish readiness rechecks first.", status: "proposed" },
      { id: "C-2", text: "Raise the readiness-recheck window from 7 to 10 days for east Village B, where ridge-spacing errors cluster (finding MF-03).", status: "proposed" },
      { id: "C-3", text: "Hold the fertilizer contract (PR-2027-015) until the donor clause and 30% damages rate are corrected; risk to activity 6 timing.", status: "proposed" },
    ],
    planApproval: { what: "Project plan and budget", by: "daniel", date: "2026-12-14", note: "Approved with the 10-step field sequence and five indicators." },
    audit: [
      { date: "2026-12-10", who: "agent:Indicator advisor", what: "Suggested IND-1 to IND-5 from the library and the donor's core set", kind: "agent" },
      { date: "2026-12-14", who: "daniel", what: "Approved project plan and budget", kind: "approval" },
      ...submissions.filter((s) => s.status === "accepted").map((s) => ({ date: s.decidedOn!, who: "omar", what: `Accepted ${s.id} (${formLabel[s.form]}, ${s.farmerId})`, kind: "approval" as const })),
    ],
  };
}

export const personName = (id: string) => (id.startsWith("agent:") ? `${id.slice(6)} (AI)` : (userById(id)?.name ?? id));

export function seedAll() {
  return { field: seedField(), procs: seedProcurements(), project: seedProject() };
}
