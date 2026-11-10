/**
 * Policy profiles: the rules an organization's own policy sets and the rules each donor sets, and
 * how the two combine for a project. The organization's policy and procedures always apply; they
 * are the floor. Where a donor requires more (more quotes, a lower competition threshold, a longer
 * advertising period, another screening list...), that is a gap: it is shown, and applies only once
 * someone approves layering it on top of the organization's procedures. Where no value can satisfy
 * both, nothing is guessed: the difference is a conflict for an administrator to decide, and the
 * decision is recorded.
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
 *  donor: the donor's value when it sets one; otherwise the organization's default (e.g. mileage rate).
 */
export type Merge = "min" | "max" | "any" | "union" | "common" | "same" | "donor";

/** The department a rule belongs to, for grouping in settings. */
export type Area = "Procurement" | "Finance" | "Travel" | "Grants" | "Reporting" | "Records";
export const DEPARTMENTS: Area[] = ["Procurement", "Finance", "Travel", "Grants", "Reporting", "Records"];
export type ParamDef = { key: string; label: string; area: Area; unit?: "USD" | "AFN" | "days" | "years" | "%" | "count" | "months"; merge: Merge; help: string };

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
  { key: "perDiemSource", label: "Per diem rates from", area: "Travel", merge: "same", help: "" },
  { key: "airClass", label: "Air travel class", area: "Travel", merge: "same", help: "" },
  { key: "mileageRateUsd", label: "Mileage rate for a personal vehicle, per mile", area: "Travel", unit: "USD", merge: "donor", help: "The donor's rate applies to mileage it pays for; otherwise the organization's default." },
  {
    key: "paymentVerifyAboveUsd",
    label: "Separate Finance verification of payments, contracts above",
    area: "Finance",
    unit: "USD",
    merge: "min",
    help: "A second Finance person verifies the payment approval form after the first has checked it. Not set: one Finance check.",
  },
  { key: "rescreenMonths", label: "Re-screen a supplier before payment when its last screening is older than", area: "Finance", unit: "months", merge: "min", help: "Against the sanctions and exclusion lists in force." },
  { key: "taxLicensedPct", label: "Tax withheld from contractors with a valid business licence", area: "Finance", unit: "%", merge: "same", help: "Checked on the payment date." },
  { key: "taxUnlicensedPct", label: "Tax withheld from contractors without a valid licence", area: "Finance", unit: "%", merge: "same", help: "Including a licence that expired before the payment date." },
  { key: "taxThresholdAfn", label: "No contractor tax withheld on contracts under", area: "Finance", unit: "AFN", merge: "same", help: "Unless the supplier's payments in the year pass it." },
  { key: "advanceSettlementDays", label: "Settle travel advances within", area: "Travel", unit: "days", merge: "min", help: "" },
  { key: "overheadMaxPct", label: "Indirect costs (overhead), at most, of direct costs", area: "Finance", unit: "%", merge: "min", help: "The donor's cap on the indirect cost rate, as the agreement states it." },
  { key: "expenseReportDays", label: "Expense report due, days after the month ends", area: "Finance", unit: "days", merge: "min", help: "" },
  { key: "grantCapUsd", label: "Sub-grant cap per grant", area: "Grants", unit: "USD", merge: "min", help: "" },
  { key: "grantCapCumulativeUsd", label: "Sub-grant cap per recipient, cumulative", area: "Grants", unit: "USD", merge: "min", help: "" },
  { key: "costSharePct", label: "Grantee cost share, at least", area: "Grants", unit: "%", merge: "max", help: "" },
  { key: "grantAssetTransfer", label: "Assets given to grantees as in-kind grants", area: "Grants", merge: "same", help: "Who owns them once handed over. Grants build up the private sector, so this is separate from the project's own equipment." },
  { key: "projectEquipment", label: "The project's own equipment (vehicles, furniture, IT) when the project ends", area: "Records", merge: "same", help: "An administrative cost of running the project, separate from grants." },
  { key: "quarterlyReportDays", label: "Quarterly report due, days after the quarter ends", area: "Reporting", unit: "days", merge: "donor", help: "The donor's deadline. A \"Report deadline\" milestone in Tasks, when there is one, takes its place for that quarter." },
  { key: "annualReportDays", label: "Annual report due, days after the year ends", area: "Reporting", unit: "days", merge: "donor", help: "" },
  { key: "packFinancials", label: "The donor's evidence pack includes Finance's budget against actual, line by line and month by month", area: "Reporting", merge: "any", help: "For donors whose reporting requires full financials. Personnel lines show pay by position, and a position with one holder shows that person's pay: the audit pack always includes it, the donor pack only with this on." },
  { key: "reviewDays", label: "Internal review before a report is due, at least", area: "Reporting", unit: "days", merge: "max", help: "Days kept free before the donor's deadline for the internal check: the team aims for this earlier date." },
  { key: "retentionYears", label: "Keep records for", area: "Records", unit: "years", merge: "max", help: "" },
  { key: "twoStepRequired", label: "Everyone signs in with a second step (an authenticator app code)", area: "Records", merge: "any", help: "Turn on only after the administrators have set up their own in Settings: until then it would lock them out. People who set one up use it either way." },
  { key: "twoStepSensitive", label: "People who see personal data sign in with a second step: administrators, HR roles and anyone who sees participants' names", area: "Records", merge: "any", help: "The data protection review's recommendation, before the income panel starts. Each of those people sets up an authenticator first; until they do, they are asked to at their next sign-in." },
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
    paymentVerifyAboveUsd: { value: 25000, source: "Large procurement threshold (April 2025 Table 1); set by T. Kuhn, 5 Nov 2026" },
    rescreenMonths: { value: 6, source: "Procurement Policy Draft 1.0 §4.8 (proposed interval)", confidence: "to verify" },
    taxLicensedPct: { value: 2, source: "Afghan Income Tax Law 2009, Art. 72 (Guide 21)" },
    taxUnlicensedPct: { value: 7, source: "Afghan Income Tax Law 2009, Art. 72 (Guide 21)" },
    taxThresholdAfn: { value: 500000, source: "Afghan Income Tax Law 2009, Art. 72 (Guide 21)" },
    mileageRateUsd: { value: 0.7, source: "ROP default: the US State Department rate (CFO, 5 Nov 2026); $0.70 confirmed by T. Kuhn, 5 Nov 2026" },
    advanceSettlementDays: { value: 30, source: "Finance and Accounting Procedure Manual 2020, §12.1.4 (the UN-projects manual says 15)" },
    expenseReportDays: { value: 0, source: "ROP Travel Policy 2021, §5: by the end of the month the costs were incurred" },
    grantCapUsd: { value: 50000, source: "CBARD Grants Manual 2023, p8 (fixed-amount and simplified grants)" },
    grantCapCumulativeUsd: { value: 100000, source: "CBARD Grants Manual 2023, p8" },
    costSharePct: { value: 50, source: "CBARD Grants Manual 2023, p8 (25% for women-owned businesses)" },
    twoStepRequired: { value: false, source: "Not in the written policy: set by an administrator" },
    twoStepSensitive: { value: false, source: "Not in the written policy: recommended by the data protection review (November 2026)" },
    reviewDays: { value: 5, source: "ROP Workflow starting value (9 Nov 2026): time for the internal check before a donor deadline. Set ROP's own in Settings.", confidence: "to verify" },
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
  /** The donor requires more than the organization's procedures and nobody has approved layering it on yet. */
  gap?: boolean;
  /** Who approved layering the donor's stricter requirement on. */
  approval?: Approval | null;
};

/** Approval to layer a stricter requirement on top of the organization's procedures. */
export type Approval = { by: string; name: string; at: string; reason: string };

/** Rules that are standards, where one value can be stricter than another. The rest are facts (rates, sources) or terms. */
const LAYERABLE: Merge[] = ["min", "max", "any", "union", "common"];
export const layerable = (def: ParamDef) => LAYERABLE.includes(def.merge);

/**
 * How a required value compares with ours. For a threshold that triggers a control ("min"), not
 * set means the control never applies, so any number is stricter than none.
 */
export function compare(def: ParamDef, required: Value, ours: Value): "stricter" | "same" | "looser" | "different" {
  const eq = JSON.stringify(required ?? null) === JSON.stringify(ours ?? null);
  if (eq) return "same";
  switch (def.merge) {
    case "min": {
      const r = required == null ? Infinity : Number(required);
      const o = ours == null ? Infinity : Number(ours);
      return r < o ? "stricter" : r > o ? "looser" : "same";
    }
    case "max": {
      const r = required == null ? -Infinity : Number(required);
      const o = ours == null ? -Infinity : Number(ours);
      return r > o ? "stricter" : r < o ? "looser" : "same";
    }
    case "any":
      return required === true && ours !== true ? "stricter" : required !== true && ours === true ? "looser" : "same";
    case "union": {
      const o = asList(ours).map(norm);
      const r = asList(required).map(norm);
      const adds = r.some((x) => !o.includes(x));
      const drops = o.some((x) => !r.includes(x));
      return adds ? "stricter" : drops ? "looser" : "same";
    }
    case "common": {
      const o = asList(ours).map(norm);
      const r = asList(required).map(norm);
      const narrows = o.some((x) => !r.includes(x));
      const widens = r.some((x) => !o.includes(x));
      return narrows ? "stricter" : widens ? "looser" : "same";
    }
    default:
      return "different";
  }
}

/** Our procedures with a stricter requirement layered on: whichever satisfies both. */
export function layered(def: ParamDef, ours: Value, required: Value): Value {
  switch (def.merge) {
    case "min":
      return ours == null ? required : required == null ? ours : Math.min(Number(ours), Number(required));
    case "max":
      return ours == null ? required : required == null ? ours : Math.max(Number(ours), Number(required));
    case "any":
      return ours === true || required === true;
    case "union": {
      const all = [...asList(ours)];
      for (const x of asList(required)) if (!all.some((y) => norm(y) === norm(x))) all.push(x);
      return all;
    }
    case "common": {
      const r = asList(required).map(norm);
      return asList(ours).filter((x) => r.includes(norm(x)));
    }
    default:
      return ours;
  }
}

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
    case "donor":
      value = d;
      why = norm(String(o)) === norm(String(d)) ? "Both say the same." : "The donor sets this for what it pays for.";
      break;
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

export type Effective = { lines: Line[]; values: Record<string, Value>; open: Line[]; gaps: Line[] };

/**
 * The rules a project follows: its organization's procedures, with each stricter donor requirement
 * layered on once approved, plus decisions on conflicts. An unapproved gap leaves the
 * organization's value in force and is shown as a gap.
 */
export function effective(org: Profile, donor: Profile | null, decisions: Record<string, Decision> = {}, approvals: Record<string, Approval> = {}): Effective {
  const lines = PARAMS.map((def) => {
    const l = combine(def, org.values[def.key], donor?.values[def.key], decisions[def.key]);
    if (!layerable(def) || !l.donor || l.conflict) return l;
    const ours = l.org?.value ?? null;
    if (compare(def, l.donor.value, ours) !== "stricter") return l;
    const a = approvals[def.key];
    return a
      ? { ...l, approval: a, why: `The donor requires more; layered on by ${a.name}, ${a.at}: ${a.reason}` }
      : { ...l, value: ours, gap: true, approval: null, why: "The donor requires more than the organization's procedures. Until someone approves layering it on, the organization's value applies." };
  });
  // Two numbers can each be right and still not fit together: an advertising period longer than the longest bid period.
  const get = (k: string) => lines.find((l) => l.key === k)!;
  const adv = Math.max(Number(get("advertisingDays").value ?? 0), Number(get("advertisingDaysLarge").value ?? 0));
  const cap = get("bidPeriodMaxDays");
  if (cap.value != null && adv > Number(cap.value) && !cap.decision) cap.conflict = `The advertising period (${adv} days) is longer than the longest bid period allowed (${cap.value} days).`;
  return { lines, values: Object.fromEntries(lines.map((l) => [l.key, l.value])), open: lines.filter((l) => l.conflict && !l.decision), gaps: lines.filter((l) => l.gap) };
}

export const show = (def: ParamDef, v: Value) => {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join("; ") : "None";
  if (def.unit === "USD") return `$${Number(v).toLocaleString("en-US", Number.isInteger(Number(v)) ? {} : { minimumFractionDigits: 2 })}`;
  if (def.unit === "AFN") return `AFN ${Number(v).toLocaleString("en-US")}`;
  if (def.unit === "%") return `${v}%`;
  if (def.unit) return `${v} ${def.unit === "count" ? "" : def.unit}`.trim();
  return String(v);
};
