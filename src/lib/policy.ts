/**
 * Policy profiles: the rules an organization's own policy sets and the rules each donor sets, and
 * how the two combine for a project. Where they differ, the project follows the value that
 * satisfies both (more quotes, a lower competition threshold, a longer advertising period, every
 * required screening list...). Where no value can satisfy both, nothing is guessed: the
 * difference is a conflict for an administrator to decide, and the decision is recorded.
 *
 * Every value carries its source. A value marked "to verify" is not yet confirmed in the primary
 * document and is shown that way wherever it is used.
 */

export type Value = number | boolean | string | string[] | null;
export type Cited = { value: Value; source: string; confidence?: "documented" | "restated" | "to verify" };

/**
 * How two values combine:
 *  min / max: the lower or higher number satisfies both (e.g. thresholds, days).
 *  any: true if either requires it.
 *  union: every item either lists (e.g. screening lists, restricted goods).
 *  common: only items both allow (e.g. procurement methods); none in common is a conflict.
 *  same: must be equal; different values are a conflict.
 */
export type Merge = "min" | "max" | "any" | "union" | "common" | "same";

export type Area = "Procurement" | "Travel and finance" | "Grants" | "Records";
export type ParamDef = { key: string; label: string; area: Area; unit?: "USD" | "days" | "years" | "%" | "count" | "months"; merge: Merge; help: string };

export const PARAMS: ParamDef[] = [
  { key: "microMaxUsd", label: "Micro purchases up to", area: "Procurement", unit: "USD", merge: "min", help: "Bought after checking prices, without written quotations." },
  { key: "microPriceChecks", label: "Prices to check for a micro purchase", area: "Procurement", unit: "count", merge: "max", help: "Verbal or market prices." },
  { key: "smallMaxUsd", label: "Written quotations up to", area: "Procurement", unit: "USD", merge: "min", help: "Above this, a written, advertised solicitation." },
  { key: "quotesSmall", label: "Written quotations needed", area: "Procurement", unit: "count", merge: "max", help: "For purchases between the micro and quotation limits." },
  { key: "largeAboveUsd", label: "Large procurement above", area: "Procurement", unit: "USD", merge: "min", help: "Above this: compliance review before award and the executive head's approval." },
  { key: "advertisingDays", label: "Advertising period, at least", area: "Procurement", unit: "days", merge: "max", help: "From first publication to the closing date, for open competition." },
  { key: "advertisingDaysLarge", label: "Advertising period for large procurements, at least", area: "Procurement", unit: "days", merge: "max", help: "" },
  { key: "bidPeriodMaxDays", label: "Bid period, at most", area: "Procurement", unit: "days", merge: "min", help: "" },
  { key: "committeeAboveUsd", label: "Bid committee required above", area: "Procurement", unit: "USD", merge: "min", help: "For lowest-price evaluations; best-value evaluations always need one." },
  { key: "committeeForBestValue", label: "Bid committee for every best-value evaluation", area: "Procurement", merge: "any", help: "" },
  { key: "soleSourceAboveUsd", label: "Sole source route applies above", area: "Procurement", unit: "USD", merge: "max", help: "Below this the micro and quotation rules apply instead." },
  { key: "soleSourceKeepsSteps", label: "A sole source still goes through committee and vendor review", area: "Procurement", merge: "any", help: "" },
  { key: "donorApprovalAboveUsd", label: "Donor prior approval above", area: "Procurement", unit: "USD", merge: "min", help: "Any procurement above this needs the donor's written approval first." },
  { key: "soleSourceDonorApproval", label: "Donor's written agreement for any sole source", area: "Procurement", merge: "any", help: "On top of the organization's own approval." },
  { key: "subcontractorApproval", label: "Donor approves each subcontractor in advance", area: "Procurement", merge: "any", help: "" },
  { key: "restrictedGoods", label: "Goods needing donor approval", area: "Procurement", merge: "union", help: "" },
  { key: "screeningLists", label: "Sanctions and exclusion lists to check", area: "Procurement", merge: "union", help: "Every supplier, at every level." },
  { key: "dueDiligenceAllLevels", label: "Vendor documents (licence, ID, bank details) at every level", area: "Procurement", merge: "any", help: "" },
  { key: "splitTrackMonths", label: "Micro spend per vendor tracked over", area: "Procurement", unit: "months", merge: "max", help: "So repeated small buys do not cross the quotation limit." },
  { key: "methods", label: "Procurement methods allowed", area: "Procurement", merge: "common", help: "" },
  { key: "vendorEvaluationAboveUsd", label: "Vendor performance evaluation above", area: "Procurement", unit: "USD", merge: "min", help: "" },
  { key: "perDiemSource", label: "Per diem rates from", area: "Travel and finance", merge: "same", help: "" },
  { key: "airClass", label: "Air travel class", area: "Travel and finance", merge: "same", help: "" },
  { key: "advanceSettlementDays", label: "Settle travel advances within", area: "Travel and finance", unit: "days", merge: "min", help: "" },
  { key: "expenseReportDays", label: "Expense report due, days after the month ends", area: "Travel and finance", unit: "days", merge: "min", help: "" },
  { key: "grantCapUsd", label: "Sub-grant cap per grant", area: "Grants", unit: "USD", merge: "min", help: "" },
  { key: "grantCapCumulativeUsd", label: "Sub-grant cap per recipient, cumulative", area: "Grants", unit: "USD", merge: "min", help: "" },
  { key: "costSharePct", label: "Grantee cost share, at least", area: "Grants", unit: "%", merge: "max", help: "" },
  { key: "grantAssetTransfer", label: "Equipment bought with project funds and given to grantees", area: "Grants", merge: "same", help: "Who owns it once it is handed over." },
  { key: "retentionYears", label: "Keep records for", area: "Records", unit: "years", merge: "max", help: "" },
];
export const paramByKey = Object.fromEntries(PARAMS.map((p) => [p.key, p])) as Record<string, ParamDef>;

export type Profile = { id: string; name: string; kind: "organization" | "donor"; summary: string; documents: { title: string; where: string }[]; values: Record<string, Cited> };

const AF25 = "ROP Procurement Policy (Afghanistan), April 2025";
/** ROP's own policy: the April 2025 procurement policy as the base (2026 governance assessment), the finance and travel manuals, the grants manual. */
export const ROP: Profile = {
  id: "rop",
  name: "Roots of Peace",
  kind: "organization",
  summary: "ROP's procurement policy of April 2025 is the base (the 2026 governance assessment names it authoritative), with the 2020 finance manual, the 2021 travel policy and the 2023 grants manual.",
  documents: [
    { title: AF25, where: "SharePoint: corp/proc/ROP_Governance_Corpus_Package/04_Procurement_and_Grants" },
    { title: "Finance and Accounting Procedure Manual, April 2020", where: "SharePoint: corp/proc/ROP_Governance_Corpus_Package/03_Finance_and_Travel" },
    { title: "ROP Travel Policy, January 2021", where: "SharePoint: corp/proc/ROP_Governance_Corpus_Package/03_Finance_and_Travel" },
    { title: "CBARD Grants Manual, July 2023", where: "SharePoint: corp/proc/ROP_Governance_Corpus_Package/04_Procurement_and_Grants" },
  ],
  values: {
    microMaxUsd: { value: 500, source: `${AF25}, Table 1 p13` },
    microPriceChecks: { value: 3, source: `${AF25}, §3.2.2 p14, §4.1 p25` },
    smallMaxUsd: { value: 5000, source: `${AF25}, Table 1 p13` },
    quotesSmall: { value: 3, source: `${AF25}, §3.2.3 p14, §4.2 p26` },
    largeAboveUsd: { value: 25000, source: `${AF25}, Table 1 p13, §2.1 p6` },
    advertisingDays: { value: 10, source: `${AF25}, §3.2.9 p19` },
    advertisingDaysLarge: { value: 14, source: `${AF25}, §4.5 step 5 p33` },
    bidPeriodMaxDays: { value: 30, source: `${AF25}, §3.2.9 p19, §4.5 p33` },
    committeeAboveUsd: { value: 25000, source: `${AF25}, §3.2.6 p15–19 (below this the committee may be waived with a signed certification)` },
    committeeForBestValue: { value: true, source: `${AF25}, §3.2.6 p15` },
    soleSourceAboveUsd: { value: 5000, source: `${AF25}, Table 1 p13` },
    soleSourceKeepsSteps: { value: true, source: `${AF25}, §3.2.4 p14–15, §4.6 p36` },
    donorApprovalAboveUsd: { value: null, source: "Set by the donor" },
    soleSourceDonorApproval: { value: false, source: `${AF25}, §3.2.4: the executive head approves; no donor step` },
    subcontractorApproval: { value: false, source: `${AF25}: no donor step` },
    grantAssetTransfer: { value: "Allowed: assets transferred to the grantee after co-payment, with photos and a signed acceptance", source: `${AF25}, §3.2.20` },
    restrictedGoods: { value: [], source: "Set by the donor" },
    screeningLists: { value: ["UN Security Council 1267 list"], source: `${AF25}, §3.2.12 p20` },
    dueDiligenceAllLevels: { value: true, source: `${AF25}, Micro and Small checklists p26–27` },
    splitTrackMonths: { value: 12, source: `${AF25}, p26` },
    methods: { value: ["RFQ, lowest price technically acceptable", "RFP, technically acceptable then lowest cost", "RFP, best value", "Sole source", "BPA and release orders"], source: `${AF25}, §4.2–4.6, §4.4.1 p32` },
    vendorEvaluationAboveUsd: { value: 5000, source: `${AF25}, §3.2.14 p22, §3.2.23 p24` },
    perDiemSource: { value: "US State Department (abroad), GSA (in the US)", source: "ROP Travel Policy, January 2021" },
    airClass: { value: "Economy", source: "ROP Travel Policy, January 2021" },
    advanceSettlementDays: { value: 30, source: "Finance and Accounting Procedure Manual 2020, §12.1.4 (the UN-projects manual says 15)" },
    expenseReportDays: { value: 0, source: "ROP Travel Policy 2021, §5: by the end of the month the costs were incurred" },
    grantCapUsd: { value: 50000, source: "CBARD Grants Manual 2023, p8 (fixed-amount and simplified grants)" },
    grantCapCumulativeUsd: { value: 100000, source: "CBARD Grants Manual 2023, p8" },
    costSharePct: { value: 50, source: "CBARD Grants Manual 2023, p8 (25% for women-owned businesses)" },
    retentionYears: { value: 5, source: "Afghan Ministry of Finance requirement, cited in ROP's document management guidance", confidence: "to verify" },
  },
};

/* ---------------- Combining ---------------- */

export type Decision = { value: Value; by: string; name: string; at: string; reason: string };
export type Line = {
  key: string;
  org: Cited | null;
  donor: Cited | null;
  value: Value;
  /** Why this value applies. */
  why: string;
  conflict: string | null;
  decision: Decision | null;
};

const asList = (v: Value) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [String(v)]);
const norm = (s: string) => s.trim().toLowerCase();

/** One parameter, combined. */
export function combine(def: ParamDef, org: Cited | undefined, donor: Cited | undefined, decision?: Decision): Line {
  const o = org?.value ?? null;
  const d = donor?.value ?? null;
  const base = { key: def.key, org: org ?? null, donor: donor ?? null, decision: decision ?? null };
  if (d == null || (Array.isArray(d) && !d.length && def.merge !== "common")) return { ...base, value: o, why: "Only the organization's policy sets this.", conflict: null };
  if (o == null || (Array.isArray(o) && !o.length && def.merge !== "common")) return { ...base, value: d, why: "Only the donor sets this.", conflict: null };
  let value: Value = o;
  let why = "";
  let conflict: string | null = null;
  switch (def.merge) {
    case "min":
      value = Math.min(Number(o), Number(d));
      why = Number(o) === Number(d) ? "Both say the same." : `The lower of the two satisfies both (${value === Number(o) ? "the organization's" : "the donor's"}).`;
      break;
    case "max":
      value = Math.max(Number(o), Number(d));
      why = Number(o) === Number(d) ? "Both say the same." : `The higher of the two satisfies both (${value === Number(o) ? "the organization's" : "the donor's"}).`;
      break;
    case "any":
      value = Boolean(o) || Boolean(d);
      why = Boolean(o) === Boolean(d) ? "Both say the same." : "Required by one of them, so required.";
      break;
    case "union": {
      const all = [...asList(o)];
      for (const x of asList(d)) if (!all.some((y) => norm(y) === norm(x))) all.push(x);
      value = all;
      why = all.length === asList(o).length ? "The donor adds nothing to the organization's list." : "Everything either requires.";
      break;
    }
    case "common": {
      const dl = asList(d).map(norm);
      const both = asList(o).filter((x) => dl.includes(norm(x)));
      value = both;
      why = "Only what both allow.";
      if (!both.length) conflict = "No option is allowed by both: the donor's list and the organization's have nothing in common.";
      break;
    }
    case "same":
      if (norm(String(o)) === norm(String(d))) {
        value = o;
        why = "Both say the same.";
      } else {
        value = null;
        conflict = `The organization says "${o}" and the donor says "${d}"; no single value satisfies both.`;
      }
      break;
  }
  if (conflict && decision) return { ...base, value: decision.value, why: `Decided by ${decision.name}: ${decision.reason}`, conflict };
  return { ...base, value, why, conflict };
}

export type Effective = { lines: Line[]; values: Record<string, Value>; open: Line[] };

/** The rules a project follows: its organization's policy combined with its donor's, plus decisions on conflicts. */
export function effective(org: Profile, donor: Profile | null, decisions: Record<string, Decision> = {}): Effective {
  const lines = PARAMS.map((def) => combine(def, org.values[def.key], donor?.values[def.key], decisions[def.key]));
  // Two numbers can each be right and still not fit together: an advertising period longer than the longest bid period.
  const get = (k: string) => lines.find((l) => l.key === k)!;
  const adv = Math.max(Number(get("advertisingDays").value ?? 0), Number(get("advertisingDaysLarge").value ?? 0));
  const cap = get("bidPeriodMaxDays");
  if (cap.value != null && adv > Number(cap.value) && !cap.decision) cap.conflict = `The advertising period (${adv} days) is longer than the longest bid period allowed (${cap.value} days).`;
  return { lines, values: Object.fromEntries(lines.map((l) => [l.key, l.value])), open: lines.filter((l) => l.conflict && !l.decision) };
}

export const show = (def: ParamDef, v: Value) => {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join("; ") : "None";
  if (def.unit === "USD") return `$${Number(v).toLocaleString("en-US")}`;
  if (def.unit) return `${v} ${def.unit === "count" ? "" : def.unit}`.trim();
  return String(v);
};
