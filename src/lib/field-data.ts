import type { Farmer, FieldItem } from "@/lib/field";
import type { FieldSetup } from "@/lib/package";
import type { ResultInput } from "@/lib/results";

/**
 * What field work leaves behind for reporting and for analysis, without anyone typing it twice:
 *
 * 1. A result, when a farmer passes a step the project counts (trained, plot ready, planted and
 *    visited): made from the step the field team already recorded, waiting for MEL like any other.
 * 2. One row per farmer with everything known about them, for a spreadsheet: who they are (by
 *    number, never by name), each step's date, how readiness went, what they received.
 */

export type StepKind = "training" | "readiness" | "visit";

export const STEP_KINDS: { id: StepKind; label: string; help: string }[] = [
  { id: "training", label: "Farmers trained", help: "Counts a farmer when their training is recorded." },
  { id: "readiness", label: "Farmers whose plot met the standard", help: "Counts a farmer when the readiness check, or the recheck after a correction, says yes." },
  { id: "visit", label: "Planting visits", help: "Counts a visit when planting is recorded." },
];

/** The step a move completes, when it is one a project can count; null for every other move. */
export function stepKind(from: string | undefined, to: string): StepKind | null {
  if (from === "train" && to === "prepare") return "training";
  if ((from === "verify" || from === "correct") && to === "distribute") return "readiness";
  if (from === "plant" && to === "complete") return "visit";
  return null;
}

const WHAT: Record<StepKind, (id: string, where: string) => string> = {
  training: (id, where) => `Farmer ${id} completed the land preparation training${where}.`,
  readiness: (id, where) => `Readiness check for farmer ${id}${where}: the plot meets the standard.`,
  visit: (id, where) => `Planting visit to farmer ${id}${where}: planting recorded.`,
};

/** The key that ties a result to the farmer and step it came from, so the same step is never counted twice. */
export const stepKey = (farmerId: string, kind: StepKind) => `${farmerId}:${kind}`;

/** The result one completed step adds to its target: one farmer (or visit), on the day, by number and village only. */
export function stepResult(f: Pick<Farmer, "id" | "gender" | "community">, kind: StepKind, date: string, by: string, target: string): ResultInput {
  const where = f.community ? ` in ${f.community}` : "";
  return {
    indicator: target,
    date,
    value: 1,
    ...(kind !== "visit" && (f.gender === "Female" || f.gender === "Male") ? { female: f.gender === "Female" ? 1 : 0, male: f.gender === "Male" ? 1 : 0 } : {}),
    ...(f.community ? { district: f.community.slice(0, 80) } : {}),
    note: `${WHAT[kind](f.id, where)} Recorded in Field activities by ${by}.`,
    files: [],
    noFile: "The proof is the farmer's record in Field activities, with its checks and dates.",
    fieldStep: stepKey(f.id, kind),
  };
}

/** The moves in a save that should each add a result, given the project's choices and what is already counted. */
export function stepResults(a: { before: Map<string, string>; items: FieldItem[]; setup: Pick<FieldSetup, "targets"> | null; taken: Set<string>; countable: Set<string>; date: string; by: string }): ResultInput[] {
  const out: ResultInput[] = [];
  for (const i of a.items) {
    if (i.kind !== "farmer") continue;
    const kind = stepKind(a.before.get(i.id), i.step);
    const target = kind ? a.setup?.targets?.[kind] : undefined;
    if (!kind || !target || !a.countable.has(target) || a.taken.has(stepKey(i.id, kind))) continue;
    out.push(stepResult(i, kind, a.date, a.by, target));
  }
  return out;
}

/* ---------- one row per farmer ---------- */

export type Given = { farmerId: string; date: string; status: string; items: { key: string; item: string; unit: string; qty: number }[] };

const first = (f: Farmer, starts: string) => f.timeline.find((e) => e.what.startsWith(starts))?.date ?? "";
const days = (a: string, b: string) => (a && b ? String(Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)) : "");

/**
 * The farmer table for analysis: one row each, the same columns for everyone. No names: a farmer
 * is their number. `given` is the project's distributions, so what each farmer received sits
 * beside how their season went.
 */
export function farmerTable(items: FieldItem[], given: Given[], stepTitle: (step: string) => string): { headers: string[]; rows: string[][] } {
  const farmers = items.filter((i): i is Farmer => i.kind === "farmer").sort((a, b) => a.id.localeCompare(b.id));
  const kinds = [...new Map(given.flatMap((g) => g.items).map((i) => [i.key, i])).values()];
  const headers = [
    "Farmer number", "Village", "Sex", "Age band", "Household size", "Hectares", "Enrolled on", "Contribution paid", "Step now",
    "Trained on", "Readiness visit asked on", "Readiness checked on", "Ready at first check", "Corrections needed", "Ready on",
    "Package given on", "Package approved", ...kinds.map((k) => `${k.item} (${k.unit})`), "Planted on",
    "Days from training to ready", "Days from ready to package", "Days from package to planting", "Open issues",
  ];
  const rows = farmers.map((f) => {
    const trained = first(f, "Training recorded");
    const firstCheck = f.timeline.find((e) => e.what.startsWith("Readiness: "));
    const readyAtFirst = firstCheck ? (firstCheck.what.startsWith("Readiness: Yes") ? "Yes" : "No") : "";
    const ready = f.timeline.find((e) => e.what.startsWith("Readiness: Yes") || e.what.startsWith("Recheck: Yes"))?.date ?? "";
    const corrections = f.timeline.filter((e) => e.what.startsWith("Readiness: No") || e.what.startsWith("Recheck: No")).length;
    // The farmer's latest distribution that was not sent back ("queried").
    const got = given.filter((g) => g.farmerId === f.id && g.status !== "queried").sort((a, b) => b.date.localeCompare(a.date))[0];
    const packageOn = got?.date ?? first(f, "Inputs distributed");
    const planted = first(f, "Planting recorded");
    return [
      f.id, f.community, f.gender, f.ageBand, String(f.householdSize), String(f.hectares), f.enrolledOn, f.contributionPaid ? "Yes" : "No", stepTitle(f.step),
      trained, first(f, "Readiness visit requested"), firstCheck?.date ?? "", readyAtFirst, firstCheck ? String(corrections) : "", ready,
      packageOn, got ? (got.status === "accepted" ? "Yes" : "Waiting") : "", ...kinds.map((k) => (got ? String(got.items.find((i) => i.key === k.key)?.qty ?? 0) : "")), planted,
      days(trained, ready), days(ready, packageOn), days(packageOn, planted), String(f.issues.filter((x) => x.status === "open").length),
    ];
  });
  return { headers, rows };
}

/** A spreadsheet file from a table. Text that starts like a formula is made plain, so a cell can never run one. */
export function toCsv(t: { headers: string[]; rows: string[][] }): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [t.headers, ...t.rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
