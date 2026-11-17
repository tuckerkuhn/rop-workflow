import type { Farmer, FieldItem } from "@/lib/field";

/**
 * What field work leaves behind for analysis: one row per farmer with everything known about
 * them, for a spreadsheet. Who they are (by number, never by name), each step's date, how
 * readiness went, what they received.
 */

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

/* ---------- one row per field record ---------- */

/** A field record as the table needs it: a training attendance, readiness check, farm visit or distribution. */
export type FieldRecord = {
  id: string;
  form: string;
  farmerId: string;
  /** The day the form says the work happened. */
  date: string;
  /** "KoboCollect", "App" or "Sample". */
  source: string;
  /** Who collected it: a person's id when known, else the KoboCollect account. Staff, never a farmer. */
  collector: string;
  status: "pending" | "accepted" | "queried";
  /** No longer in KoboToolbox: kept for audit, not counted. */
  removed: boolean;
  decidedBy: string;
  decidedOn: string;
  photo: boolean;
  /** The form's own answers, already reduced to what the review queue shows (no GPS, no names). */
  fields: Record<string, string>;
};

const STATUS: Record<FieldRecord["status"], string> = { pending: "Waiting", accepted: "Accepted", queried: "Sent back" };

/**
 * The field records table for analysis: one row per record, so a farmer visited three times has
 * three rows. It answers what one row per farmer cannot: visits per farmer, attendance by
 * session, who collected what, and how long a record waits for its decision. Farmers are numbers,
 * never names. Each form's answers get their own columns, named "<form>: <question>", so records
 * of different forms sit in one sheet and can be joined to the farmer table by farmer number.
 */
export function recordTable(records: FieldRecord[], formTitle: (form: string) => string): { headers: string[]; rows: string[][] } {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.form.localeCompare(b.form) || a.farmerId.localeCompare(b.farmerId) || a.id.localeCompare(b.id));
  // One column per form and question, in the order the forms and questions first appear by form name.
  const answers = [...new Set([...sorted].sort((a, b) => a.form.localeCompare(b.form)).flatMap((r) => Object.keys(r.fields).map((k) => `${r.form}\u0000${k}`)))];
  const headers = ["Record", "Form", "Farmer number", "Date", "Collected with", "Collected by", "Photo attached", "Decision", "Decided by", "Decided on", "Days to decision", "Still in KoboToolbox", ...answers.map((a) => `${formTitle(a.split("\u0000")[0])}: ${a.split("\u0000")[1].replace(/_/g, " ")}`)];
  const rows = sorted.map((r) => [
    r.id, formTitle(r.form), r.farmerId, r.date, r.source, r.collector, r.photo ? "Yes" : "No", STATUS[r.status], r.decidedBy, r.decidedOn,
    r.status === "pending" ? "" : days(r.date, r.decidedOn), r.source === "KoboCollect" ? (r.removed ? "No" : "Yes") : "",
    ...answers.map((a) => (a.split("\u0000")[0] === r.form ? (r.fields[a.split("\u0000")[1]] ?? "") : "")),
  ]);
  return { headers, rows };
}
