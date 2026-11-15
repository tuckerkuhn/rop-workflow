import type { Bva, BvaLine } from "@/lib/bva";
import type { Budget, WorkplanItem } from "@/lib/budget";
import type { ActivityBook } from "@/lib/activities";
import type { Framework } from "@/lib/framework";
import type { Submission, SubmissionForm } from "@/lib/project";
import type { ResultInput } from "@/lib/results";

/**
 * The demo project's design (A-2027, fictional): its results framework, budget, workplan and the
 * spending Finance has sent so far. The demo used to open with field work and purchases but no
 * plan behind them, so Progress, Budget, Activities and the procurement calendar were empty.
 * With this, what the field team records is counted against a target, and what procurement buys
 * is bought on a budget line that Budget and spending shows.
 *
 * Everything here is invented. The budget line codes are the ones the demo's purchases and input
 * package already name (lib/procurement, lib/package), so nothing has to be typed twice.
 */

const SOURCE = "Demo project design (fictional)";
const st = (text: string) => ({ text, source: SOURCE, by: "demo", byName: "Sample data", at: "" });

/** The wording of each level, so the Progress table and the report read as sentences, not codes. */
export const demoFramework = (at: string): Framework => {
  const s = (text: string) => ({ ...st(text), at });
  return {
    goal: s("Smallholder families in Village B earn more from maize, sustainably"),
    nodes: {
      "1": s("Farmers adopt improved maize practices"),
      "1.1": s("Farmers trained in improved land preparation and planting"),
      "1.2": s("Farmers equipped with quality inputs"),
    },
  };
};

/**
 * Where each target sits in the framework (its donor code) and the workplan row that delivers it.
 * IND-3 is measured at the outcome; IND-5 (income, from a survey at the end of the season) has no
 * place under an output and is listed with the other targets.
 */
export const DEMO_TARGET_PLACES: Record<string, { donorCode: string; workplanCode: string | null; budgetRef: string | null }> = {
  "IND-1": { donorCode: "1.1.1.1", workplanCode: "1.1.1.1", budgetRef: "4.1" },
  "IND-4": { donorCode: "1.1.2.1", workplanCode: "1.1.2.1", budgetRef: "4.2" },
  "IND-2": { donorCode: "1.2.1.1", workplanCode: "1.2.1.2", budgetRef: "2.1" },
  "IND-3": { donorCode: "1.a", workplanCode: "1.1.2.1", budgetRef: null },
};

type Line = { code: string; description: string; total: number; kind: "program" | "personnel" | "operations"; activityCode: string | null; activity: string | null; procure: boolean; /** Spent in the latest month Finance has sent. */ lastMonth: number; /** Spent in each month before it. */ monthly: number };

const ACT = {
  train: ["1.1.1", "Train farmers in land preparation and planting"],
  visit: ["1.1.2", "Visit farms and check readiness"],
  inputs: ["1.2.1", "Buy and distribute the farm input package"],
  machines: ["1.2.2", "Provide mechanization services"],
} as const;
const line = (code: string, description: string, total: number, kind: Line["kind"], act: readonly [string, string] | null, procure: boolean, lastMonth: number, monthly = 0): Line => ({ code, description, total, kind, activityCode: act?.[0] ?? null, activity: act?.[1] ?? null, procure, lastMonth, monthly });

/**
 * The budget. Lines 2.1 and 2.2 carry what the two closed purchases cost (the first lots of seed
 * and fertilizer), so the spending Finance imported agrees with what procurement paid. Training
 * materials (4.1) are over their line, so Budget and spending has one line to explain.
 */
export const DEMO_LINES: Line[] = [
  line("1.1", "Field staff salaries", 96000, "personnel", null, false, 4000, 4000),
  line("1.2", "Monitoring and evaluation officer", 30000, "personnel", null, false, 1250, 1250),
  line("2.1", "Seed and planting material", 45000, "program", ACT.inputs, true, 3100),
  line("2.2", "Fertilizer", 38000, "program", ACT.inputs, true, 260),
  line("2.3", "Crop protection equipment", 12000, "program", ACT.inputs, true, 0),
  line("2.4", "Post-harvest equipment", 28000, "program", ACT.inputs, true, 0),
  line("2.5", "Soil testing", 2000, "program", ACT.inputs, true, 0),
  line("3.1", "Mechanization", 34000, "program", ACT.machines, true, 0),
  line("4.1", "Farmer training", 24000, "program", ACT.train, false, 1900, 900),
  line("4.2", "Farm visits and follow-up", 9000, "program", ACT.visit, false, 350, 150),
  line("4.3", "Training materials and printing", 1200, "program", ACT.train, false, 1350),
  line("5.1", "Vehicle rental and fuel", 18000, "operations", null, false, 750, 750),
  line("5.2", "Office and communications", 9000, "operations", null, false, 375, 375),
];

const first = (d: string) => `${d.slice(0, 7)}-01`;
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const at = y * 12 + (m - 1) + n;
  return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
};
const quarterOf = (month: string) => `${month.slice(0, 4)}-${String(Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;

/** The months Finance has sent: from the project's first month to the month before `today`, at most the last six. */
export function demoMonths(start: string, today: string): string[] {
  const last = addMonths(today.slice(0, 7), -1);
  const out: string[] = [];
  for (let m = start.slice(0, 7); m <= last; m = addMonths(m, 1)) out.push(m);
  return out.slice(-6);
}

export function demoBudget(today: string): Budget {
  // What is left of each line, planned evenly over this quarter and the next three.
  const q0 = quarterOf(today.slice(0, 7));
  const quarters = [0, 3, 6, 9].map((n) => first(`${addMonths(q0.slice(0, 7), n)}-01`));
  return {
    currency: "USD",
    lines: DEMO_LINES.map((l) => ({
      code: l.code,
      activityCode: l.activityCode,
      activity: l.activity,
      description: l.description,
      unit: null,
      quantity: null,
      unitCost: null,
      total: l.total,
      spent: null,
      schedule: Object.fromEntries(quarters.map((q) => [q, Math.round(l.total / quarters.length)])),
      kind: l.kind,
      procure: l.procure,
    })),
  };
}

/** Finance's spending for the months sent so far, in the shape an imported workbook has. Null when no month has ended yet. */
export function demoSpending(start: string, today: string): Bva | null {
  const months = demoMonths(start, today);
  if (!months.length) return null;
  const lines: BvaLine[] = DEMO_LINES.map((l) => {
    const by = Object.fromEntries(months.map((m, i) => [m, i === months.length - 1 ? l.lastMonth : l.monthly]));
    return { code: l.code, description: l.description, budget: l.total, actual: Object.values(by).reduce((a, b) => a + b, 0), months: by };
  });
  const sum = (f: (l: BvaLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  const totals = { budget: sum((l) => l.budget), actual: sum((l) => l.actual), months: Object.fromEntries(months.map((m) => [m, sum((l) => l.months[m] ?? 0)])) };
  return {
    sheet: "Sample",
    currency: "USD",
    months,
    monthLabels: Object.fromEntries(months.map((m) => [m, new Date(`${m}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })])),
    lines,
    totals: { costs: totals, overhead: null, grand: totals },
    rate: null,
    problems: [],
    notes: ["Fictional spending for the demo project."],
  };
}

type Row = { code: string; act: readonly [string, string]; title: string; indicator: string | null; unit: string | null; perQuarter: number | null; owner: string; status: "in_progress" | "not_started"; quarters: number };
const ROWS: Row[] = [
  { code: "1.1.1.1", act: ACT.train, title: "Farmer trainings on land preparation", indicator: "Farmers trained in land preparation", unit: "farmers", perQuarter: 25, owner: "farida", status: "in_progress", quarters: 4 },
  { code: "1.1.1.2", act: ACT.train, title: "Print training materials", indicator: null, unit: null, perQuarter: null, owner: "farida", status: "in_progress", quarters: 1 },
  { code: "1.1.2.1", act: ACT.visit, title: "Farm visits and readiness checks", indicator: "Farm visits completed", unit: "visits", perQuarter: 50, owner: "omar", status: "in_progress", quarters: 4 },
  { code: "1.2.1.1", act: ACT.inputs, title: "Buy seed, fertilizer, equipment and soil testing kits for the input package", indicator: null, unit: null, perQuarter: null, owner: "zahra", status: "in_progress", quarters: 2 },
  { code: "1.2.1.2", act: ACT.inputs, title: "Distribute the farm input package", indicator: "Farmers receiving the input package", unit: "farmers", perQuarter: 25, owner: "bilal", status: "in_progress", quarters: 4 },
  { code: "1.2.2.1", act: ACT.machines, title: "Mechanization: tractor services for land preparation", indicator: null, unit: null, perQuarter: null, owner: "nadia", status: "not_started", quarters: 3 },
];

/** ROP's workplan: who delivers each piece of work, in which quarters, starting from this one. */
export function demoWorkplan(today: string): WorkplanItem[] {
  const q0 = quarterOf(today.slice(0, 7)).slice(0, 7);
  return ROWS.map((r) => {
    // Work not started yet begins next quarter; the rest is under way now.
    const from = r.status === "not_started" ? 1 : 0;
    const active = Array.from({ length: r.quarters }, (_, i) => first(`${addMonths(q0, (from + i) * 3)}-01`));
    return {
      code: r.code,
      activityCode: r.act[0],
      activity: r.act[1],
      title: r.title,
      indicator: r.indicator,
      unit: r.unit,
      org: "ROP",
      targets: r.perQuarter ? Object.fromEntries(active.map((q) => [q, r.perQuarter!])) : {},
      active,
      start: active[0],
      end: null,
      remark: null,
    };
  });
}

/** Who owns each workplan row and where it stands, so Activities opens with owners, not blanks. */
export function demoActivities(today: string): ActivityBook {
  return { items: Object.fromEntries(ROWS.map((r) => [r.code, { status: r.status, owner: r.owner, startedOn: r.status === "in_progress" ? first(today) : null, doneOn: null, blocker: "", tasks: [], history: [] }])) };
}

/* ---------- the demo's results ---------- */

/**
 * The target each kind of field record counts toward. These four take recorded results, as a real
 * project's targets do, so the demo's Progress, monthly review and quarterly report show what the
 * field team did. IND-5 (income) comes from a survey at the end of the season.
 */
export const DEMO_RESULT_TARGETS: Record<SubmissionForm, string> = { training: "IND-1", distribution: "IND-2", readiness: "IND-3", visit: "IND-4" };
export const demoTakesResults = (indicator: string) => Object.values(DEMO_RESULT_TARGETS).includes(indicator);

const WHAT: Record<SubmissionForm, (s: Submission) => string> = {
  training: (s) => `Farmer ${s.farmerId} attended the ${String(s.fields.session ?? "land preparation").toLowerCase()} training in Village B.`,
  distribution: (s) => `Input package given to farmer ${s.farmerId} in Village B: ${s.fields.seed_kg ?? "10"} kg certified maize seed and ${s.fields.npk_kg ?? "50"} kg NPK 17-17-17.`,
  readiness: (s) => `Readiness visit to farmer ${s.farmerId} in Village B: the plot meets the land-preparation standard.`,
  visit: (s) => `Farm visit to farmer ${s.farmerId} in Village B: ${String(s.fields.purpose ?? "follow-up").toLowerCase()}.`,
};
export const DEMO_PROOF: Record<SubmissionForm, string> = { training: "Attendance sheet", distribution: "Distribution register", readiness: "Readiness checklist", visit: "Visit report" };

export type DemoResult = { payload: ResultInput; status: Submission["status"]; by: string; reviewedBy: string | null; reviewedOn: string | null };

/**
 * One result for each sample field record that counts: a farmer trained, a package given, a plot
 * that met the standard, a visit made. A record MEL had accepted is an accepted result; one still
 * waiting is a result waiting for MEL. Farmers are named by number only. `proof` gives each
 * record's own file, by the sample record's id: one shared file would look like a double count.
 */
export function demoResults(subs: Submission[], proof: Record<string, ResultInput["files"][number]> = {}): DemoResult[] {
  return subs
    .filter((s) => s.form !== "readiness" || s.fields.result === "Yes")
    // A distribution still waiting for the project manager is not a result yet: her approval makes
    // it one (server/distribution), and a result here as well would count that farmer twice.
    .filter((s) => !(s.form === "distribution" && s.status === "pending"))
    .map((s) => {
      const file = proof[s.id];
      const g = s.fields.gender;
      return {
        payload: {
          indicator: DEMO_RESULT_TARGETS[s.form],
          date: s.date,
          value: 1,
          ...(s.form !== "visit" && (g === "Female" || g === "Male") ? { female: g === "Female" ? 1 : 0, male: g === "Male" ? 1 : 0 } : {}),
          district: "Village B",
          crop: "Maize",
          note: WHAT[s.form](s),
          files: file ? [file] : [],
          ...(file ? {} : { noFile: "Sample record: no file is attached." }),
          // Tied to the farmer's step, so recording that step in Field activities later does not count it again.
          ...(s.form === "training" || s.form === "readiness" || (s.form === "visit" && s.fields.purpose === "Planting follow-up") ? { fieldStep: `${s.farmerId}:${s.form}` } : {}),
        },
        status: s.status,
        // Recorded by the field team and checked by MEL: a result the MEL officer recorded himself
        // would have nobody to accept it.
        by: s.form === "distribution" ? "bilal" : "farida",
        reviewedBy: s.decidedBy ?? null,
        reviewedOn: s.decidedOn ?? null,
      };
    });
}
