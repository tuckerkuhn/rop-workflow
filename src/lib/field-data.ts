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
