import { DONORS } from "@/lib/donors";
import { compare, layerable, layered, paramByKey, type ParamDef, type Value } from "@/lib/policy";

/**
 * Requirement profiles: sets of standards an organization may need to meet (a funder family's
 * rules, a tighter control set). The organization's own policy and procedures always apply. A
 * profile is compared with them: where it requires more, that is a gap an administrator can approve
 * to layer on top of the procedures; where the procedures already require as much or more, they
 * stay as they are. A profile never loosens anything.
 */
export type Profile = { id: string; name: string; summary: string; values: Record<string, Value>; source: Record<string, string> };

/**
 * Terms of a donor's own agreement (its approvals, its equipment, its grant caps, its restricted
 * goods). A project gets them from its donor profile; they are not the organization's own
 * standards, so a funder-family profile leaves them out.
 */
const DONOR_TERMS = new Set(["donorApprovalAboveUsd", "soleSourceDonorApproval", "subcontractorApproval", "restrictedGoods", "projectEquipment", "grantCapUsd", "grantCapCumulativeUsd", "costSharePct", "mileageRateUsd"]);

function fromDonor(donorId: string, id: string, name: string, summary: string): Profile {
  const donor = DONORS.find((d) => d.id === donorId)!;
  const entries = Object.entries(donor.values).filter(([k, c]) => !DONOR_TERMS.has(k) && c.value !== null && paramByKey[k] && layerable(paramByKey[k]));
  return { id, name, summary, values: Object.fromEntries(entries.map(([k, c]) => [k, c.value])), source: Object.fromEntries(entries.map(([k, c]) => [k, `${donor.name}: ${c.source}`])) };
}

const own = (id: string, name: string, summary: string, why: string, values: Record<string, Value>): Profile => ({ id, name, summary, values, source: Object.fromEntries(Object.keys(values).map((k) => [k, why])) });

export const PROFILES: Profile[] = [
  fromDonor("undp", "un", "UN", "Standards UNDP expects of its partners, beyond the agreement terms each UN-funded project gets from its donor profile: for example records kept 7 years."),
  fromDonor("worldbank", "worldbank", "World Bank", "The World Bank Procurement Regulations' standards: 42 days' advertising for large procurements, the Bank's debarment list checked as well."),
  own("conservative", "Conservative", "Tighter controls for higher-risk settings or after audit findings: lower thresholds, longer advertising, more frequent screening, a second Finance check on more payments, faster settlement of advances.", "Conservative profile", {
    microMaxUsd: 250,
    smallMaxUsd: 3000,
    largeAboveUsd: 15000,
    committeeAboveUsd: 10000,
    advertisingDays: 14,
    advertisingDaysLarge: 21,
    dueDiligenceAllLevels: true,
    vendorEvaluationAboveUsd: 2500,
    rescreenMonths: 3,
    paymentVerifyAboveUsd: 5000,
    advanceSettlementDays: 15,
  }),
  own(
    "small",
    "Small staff",
    "For an office with few people, where one person often holds several roles. Fewer separate sign-offs are possible, so the documents carry more of the control: vendor licence, ID and bank details on file at every level, Micro included. Our procedures always apply, so where they already ask for more, they stay.",
    "Small-staff profile: with fewer people to separate duties, vendor documents at every level",
    {
      dueDiligenceAllLevels: true,
      committeeAboveUsd: 25000,
      vendorEvaluationAboveUsd: 25000,
      paymentVerifyAboveUsd: null,
    },
  ),
];
export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? null;

export type Comparison = {
  key: string;
  ours: Value;
  required: Value;
  /** gap: the profile requires more; met: our procedures already say the same; ours: our procedures require more and stay. */
  status: "gap" | "met" | "ours";
  result: Value;
  source: string;
};

/** A profile against the organization's rules in force. */
export function compareProfile(p: Profile, current: Record<string, Value>): Comparison[] {
  return Object.entries(p.values).flatMap(([key, required]) => {
    const def = paramByKey[key];
    if (!def || !layerable(def)) return [];
    const ours = current[key] ?? null;
    const c = compare(def, required, ours);
    const status = c === "stricter" ? "gap" : c === "same" ? "met" : "ours";
    return [{ key, ours, required, status, result: status === "gap" ? layered(def, ours, required) : ours, source: p.source[key] ?? p.name }];
  });
}

/** What kind of value a rule takes, for editing and checking. */
export function kindOf(def: ParamDef): "number" | "boolean" | "list" | "text" {
  if (def.unit) return "number";
  if (def.merge === "any") return "boolean";
  if (def.merge === "union" || def.merge === "common") return "list";
  return "text";
}

/** Whether a value fits a rule; null means "not set". */
export function fits(def: ParamDef, v: Value): boolean {
  if (v === null) return true;
  switch (kindOf(def)) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) && v >= 0;
    case "boolean":
      return typeof v === "boolean";
    case "list":
      return Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0 && x.length <= 200) && v.length <= 40;
    default:
      return typeof v === "string" && v.length <= 300;
  }
}

/**
 * Whether a change keeps to the written policy. A standard may be made stricter, or brought back
 * to the written policy, never loosened below it. Facts that are not standards (tax rates set by
 * law, where per diem rates come from) may be updated when they change.
 */
export function keepsToPolicy(def: ParamDef, value: Value, written: Value): boolean {
  if (!layerable(def)) return true;
  const c = compare(def, value, written);
  return c === "stricter" || c === "same";
}
