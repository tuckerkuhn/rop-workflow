import type { ResultRecord } from "@/lib/results";
import { proofCount } from "@/lib/results";

/**
 * Checks on a recorded result, shown to the MEL owner before accepting it: the "data checker".
 * Rules, not AI, so the same record always gets the same flags. Flags inform; MEL decides.
 */

export type Indicator = { code: string; unit: string; disaggregation: string[] | null };

/** The last day of the quarter a date falls in. */
const quarterEnd = (date: string) => {
  const y = Number(date.slice(0, 4));
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  return new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10);
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function dataChecks(r: ResultRecord, all: ResultRecord[], ind: Indicator | undefined): string[] {
  const out: string[] = [];
  const same = all.filter((x) => x.id !== r.id && x.indicator === r.indicator && x.status !== "queried");
  // Possible double count: same indicator, date, value and place as another record, and the same
  // description or proof (two different business plans on one day are not a double count).
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const shares = (x: ResultRecord) => norm(x.note) === norm(r.note) || x.files.some((f) => r.files.some((g) => g.hash === f.hash)) || (x.links ?? []).some((l) => (r.links ?? []).some((m) => m.url === l.url));
  const twin = same.find((x) => x.date === r.date && x.value === r.value && (x.province ?? "") === (r.province ?? "") && (x.district ?? "") === (r.district ?? "") && shares(x));
  if (twin) out.push(`Same indicator, date, value and place as a ${twin.status} record by ${twin.by}: is it counted twice?`);
  // Far above what this indicator usually records.
  const values = same.filter((x) => x.status === "accepted").map((x) => x.value);
  if (values.length >= 3) {
    const m = median(values);
    if (m > 0 && r.value > m * 4) out.push(`${r.value.toLocaleString("en-US")} is more than four times the usual record for this indicator (median ${m.toLocaleString("en-US")}): check the figure and its unit.`);
  }
  // Women and men should add up to the total when both are given for people.
  if (r.female !== undefined && r.male !== undefined && r.female + r.male !== r.value && /person|people|farmer|trainee|beneficiar|participant|household/i.test(ind?.unit ?? ""))
    out.push(`${r.female} women and ${r.male} men make ${r.female + r.male}, not ${r.value}.`);
  // What the indicator is broken down by, and the record leaves out.
  const by = ind?.disaggregation ?? [];
  if (by.includes("sex") && r.female === undefined && r.male === undefined && r.womenLed === undefined && r.menLed === undefined) out.push("The indicator is reported by sex, but the record has no women and men.");
  if (by.includes("province") && !r.province) out.push("The indicator is reported by province, but the record has none.");
  if (by.includes("district") && !r.district) out.push("The indicator is reported by district, but the record has none.");
  if (!proofCount(r)) out.push(r.noFile ? `No proof attached (${r.noFile}).` : "No proof attached.");
  if (r.original?.pending) out.push("Written in Dari or Pashto and not yet translated: the report needs it in English. Translate it before accepting.");
  // Every dated photo taken after the quarter the result is counted in: was it done then?
  const dates = Object.values(r.taken ?? {}).sort();
  const qEnd = quarterEnd(r.date);
  if (dates.length && dates[0] > qEnd) out.push(`Its photos are dated ${dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`}, after the quarter it is counted in (ends ${qEnd}): was the work done by then?`);
  return out;
}
