import { z } from "zod";
import { PARAMS, paramByKey, type Cited, type Value } from "@/lib/policy";

/**
 * What setup reads from the signed agreement beyond the design (A3): the reporting obligations,
 * which become dated "Report deadline" milestones in Tasks (and feed pre-flight), and the donor's
 * checkable rules, which become the project's "From the agreement" policy layer. Every value
 * carries where it came from ("Agreement, clause 8.2"). The AI proposes; a named person confirms
 * each section; nothing is saved before that.
 */

export const FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual", "final", "once"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const obligationSchema = z.object({
  report: z.string().trim().min(2).max(160),
  frequency: z.enum(FREQUENCIES),
  /** Days after the end of each period (or the project's end, for a final report). Null when the agreement gives dates instead. */
  daysAfterPeriod: z.number().int().min(0).max(365).nullable(),
  /** Dates the agreement names outright, YYYY-MM-DD. */
  dueDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(40),
  format: z.string().max(300),
  source: z.string().max(200),
});
export type Obligation = z.infer<typeof obligationSchema>;

/** A rule mapped to a policy setting (lib/policy PARAMS), with the value as the agreement states it. */
export const ruleSchema = z.object({
  key: z.string().refine((k) => !!paramByKey[k], "Not a policy setting."),
  value: z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]),
  source: z.string().max(200),
  quote: z.string().max(400),
});
export type AgreementRule = z.infer<typeof ruleSchema>;
export const termSchema = z.object({ text: z.string().trim().min(3).max(600), source: z.string().max(200) });
export type AgreementTerm = z.infer<typeof termSchema>;

/** The confirmed layer in the project's policy setting. */
export type AgreementLayer = {
  values: Record<string, Cited & { by: string; at: string }>;
  terms: (AgreementTerm & { by: string; at: string })[];
  file?: string;
};

/** Setting keys the AI may map rules to: the checkable ones, with how to read each. */
export const RULE_KEYS = PARAMS.map((p) => ({ key: p.key, label: p.label, unit: p.unit ?? (p.merge === "any" ? "yes/no" : p.merge === "union" || p.merge === "common" ? "list" : "text") }));

/** A proposed rule's value as the setting stores it, or null when it does not fit the setting. */
export function ruleValue(key: string, v: unknown): Value | null {
  const def = paramByKey[key];
  if (!def) return null;
  if (def.merge === "any") return typeof v === "boolean" ? v : null;
  if (def.merge === "union" || def.merge === "common") return Array.isArray(v) ? v.map(String).slice(0, 30) : typeof v === "string" && v ? [v] : null;
  if (def.unit) {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dateIso: string, n: number) => iso(new Date(Date.parse(`${dateIso}T00:00:00Z`) + n * 864e5));
const monthEnd = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));

/** The end of every period of a frequency between the project's start and end. */
function periodEnds(f: Frequency, start: string, end: string): string[] {
  const step = f === "monthly" ? 1 : f === "quarterly" ? 3 : f === "semiannual" ? 6 : f === "annual" ? 12 : 0;
  if (!step) return f === "final" ? [end] : [];
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = 0;
  // Calendar periods: the first one that ends on or after the start.
  while (true) {
    m += step;
    if (m > 12) {
      y += Math.floor((m - 1) / 12);
      m = ((m - 1) % 12) + 1;
    }
    const e = monthEnd(y, m);
    if (e < start) continue;
    out.push(e < end ? e : end);
    if (e >= end || out.length > 200) break;
  }
  return out;
}

export type ProposedDeadline = { title: string; date: string; source: string };

/** The dated deadlines an obligation gives over the project's life: named dates, else periods plus the days allowed. */
export function deadlinesFrom(o: Obligation, start: string, end: string): ProposedDeadline[] {
  if (o.dueDates.length) return o.dueDates.map((d) => ({ title: o.report, date: d, source: o.source }));
  if (o.daysAfterPeriod === null) return [];
  return periodEnds(o.frequency, start, end).map((e) => ({ title: `${o.report} (period to ${e})`, date: addDays(e, o.daysAfterPeriod!), source: o.source }));
}

/** The policy setting a reporting obligation also sets (pre-flight's deadline rule), when it gives days after the period. */
export function reportDaysRule(o: Obligation): { key: "quarterlyReportDays" | "annualReportDays"; value: number } | null {
  if (o.daysAfterPeriod === null) return null;
  if (o.frequency === "quarterly" && /progress|narrative|report/i.test(o.report)) return { key: "quarterlyReportDays", value: o.daysAfterPeriod };
  if (o.frequency === "annual") return { key: "annualReportDays", value: o.daysAfterPeriod };
  return null;
}
