import { z } from "zod";

/**
 * Agribusiness grants a project gives to firms, associations and community groups (ROP Grants
 * Manual, CBARD July 2023: the ACRP copy follows it). Each grant moves through the manual's steps,
 * from the expression of interest to closeout; a step is finished when its checklist is complete,
 * and approval needs the person the manual names: the Chief of Party up to the Home Office
 * threshold, the Home Office above it. A project can rename or skip steps, so a donor's own
 * manual (ARLP will follow the World Bank's Project Implementation Manual) fits without new code.
 * Kept per project in project_state "grants" (server/grants-store.ts).
 */

export const GRANT_STEPS = ["eoi", "survey", "application", "evaluation", "approval", "agreement", "implementation", "closeout"] as const;
export type GrantStep = (typeof GRANT_STEPS)[number];
/** Steps that cannot be skipped: without them there is no decision, no agreement or no record of the money. */
export const REQUIRED_STEPS: GrantStep[] = ["evaluation", "approval", "agreement", "implementation", "closeout"];

export const GRANT_TYPES = ["inKind", "fixedAmount", "simplified", "matching"] as const;
export type GrantType = (typeof GRANT_TYPES)[number];

export type GrantStatus = "open" | "done" | "rejected" | "withdrawn";

export type Tick = { by: string; byName: string; at: string; note?: string };
export type GrantEvent = { at: string; by: string; byName: string; what: string };

export type Grant = {
  /** "G-001", per project. */
  id: string;
  /** Raised on every save: a change made from an older copy is refused. */
  rev: number;
  /** The business, association or group, as on its licence. People's names are not kept here. */
  business: string;
  province: string;
  type: GrantType;
  /** What the grant pays for, in a sentence. */
  purpose: string;
  /** The project's share, in USD. */
  value: number;
  /** The whole investment, the grantee's share included, in USD. */
  investment: number;
  womenOwned: boolean;
  /** The workplan sub-activity it serves ("1.2.1.3"). Older grants have none. */
  activity?: string | null;
  /** The budget line it is paid from. */
  budgetLine?: string | null;
  step: GrantStep;
  /** When it reached its current step (YYYY-MM-DD). */
  since: string;
  status: GrantStatus;
  checks: Record<string, Tick>;
  /** The Chief of Party's or Home Office's approval. */
  approval: (Tick & { as: string }) | null;
  /** The grantee's contribution proven so far, in USD, with what proves it. */
  contributions: { amount: number; proof: string; by: string; byName: string; at: string }[];
  /** In-kind grants: the procurements that buy the equipment ("PR-2027-014"). Requests started from the grant also carry its id (Procurement.grant). */
  procurements: string[];
  /** Why it was rejected or withdrawn. */
  closedWhy: string | null;
  history: GrantEvent[];
};

/** A project's own version of the steps: names it uses and steps it does not have. */
export type StepSettings = { names: Partial<Record<GrantStep, string>>; skip: GrantStep[]; source: string };
export const DEFAULT_STEP_SETTINGS: StepSettings = { names: {}, skip: [], source: "" };

export type CheckItem = { id: string; step: GrantStep; /** Only for these grant types; all when missing. */ types?: GrantType[]; /** Ticked only when it applies; never blocks. */ optional?: boolean };

/** What each step needs, from the manual's Table 1 (Grant Documentation Requirements). */
export const CHECKLIST: CheckItem[] = [
  { id: "eoiForm", step: "eoi" },
  { id: "eoiReview", step: "eoi" },
  { id: "pass", step: "survey" },
  { id: "application", step: "application" },
  { id: "worksheet", step: "application", types: ["inKind"] },
  { id: "equipmentSpec", step: "application", types: ["inKind"] },
  { id: "priceCheck", step: "application", types: ["fixedAmount", "simplified", "matching"] },
  { id: "licence", step: "application" },
  { id: "ids", step: "application" },
  { id: "sanctions", step: "application" },
  { id: "coi", step: "application" },
  { id: "environment", step: "application", optional: true },
  { id: "tecForms", step: "evaluation" },
  { id: "tecCoi", step: "evaluation" },
  { id: "tecMemo", step: "evaluation" },
  { id: "agreementSigned", step: "agreement" },
  { id: "siteVisits", step: "implementation" },
  { id: "contributionProof", step: "implementation" },
  { id: "budgetTracker", step: "implementation" },
  { id: "equipmentInspected", step: "implementation", types: ["inKind"] },
  { id: "grn", step: "implementation", types: ["inKind"] },
  { id: "photos", step: "implementation" },
  { id: "completionReport", step: "closeout" },
  { id: "costShareReport", step: "closeout" },
  { id: "disposition", step: "closeout", optional: true },
];

export const itemsFor = (g: Pick<Grant, "type">, step: GrantStep) => CHECKLIST.filter((c) => c.step === step && (!c.types || c.types.includes(g.type)));

/** The steps this project uses, in order. */
export const stepsIn = (s: StepSettings): GrantStep[] => GRANT_STEPS.filter((x) => !s.skip.includes(x) || REQUIRED_STEPS.includes(x));

export type GrantRules = {
  /** The grantee's share of the investment, at least, in %. Women-owned businesses have their own. */
  costSharePct: number;
  costShareWomenPct: number;
  /** The Home Office approves above this; the Chief of Party up to it. */
  hoAboveUsd: number;
  capUsd: number | null;
};

/** The grantee's share of the whole investment, in %. */
export const granteeSharePct = (g: Pick<Grant, "value" | "investment">) => (g.investment > 0 ? Math.round(((g.investment - g.value) / g.investment) * 1000) / 10 : 0);
export const shareNeeded = (g: Pick<Grant, "womenOwned">, r: GrantRules) => (g.womenOwned ? r.costShareWomenPct : r.costSharePct);
export const contributed = (g: Pick<Grant, "contributions">) => g.contributions.reduce((s, c) => s + c.amount, 0);

/** Who approves: "ho" (the Home Office: executive head) above the threshold, else "cop" (programme management). */
export const approverFor = (g: Pick<Grant, "value">, r: GrantRules): "cop" | "ho" => (g.value > r.hoAboveUsd ? "ho" : "cop");

/** A procurement as a grant sees it: whether its goods have been received. */
export type GrantProc = { id: string; received: boolean };

/** What still stands between the grant and its next step, as message keys with values. Empty: it can move on. `procs`: its linked procurements, when known. */
export function blockers(g: Grant, r: GrantRules, procs?: GrantProc[]): { key: string; vars?: Record<string, string | number> }[] {
  const out: { key: string; vars?: Record<string, string | number> }[] = [];
  for (const c of itemsFor(g, g.step)) if (!c.optional && !g.checks[c.id]) out.push({ key: `gr.check.${c.id}` });
  if (g.step === "application") {
    const need = shareNeeded(g, r);
    if (granteeSharePct(g) < need) out.push({ key: "gr.block.share", vars: { have: granteeSharePct(g), need } });
  }
  if (g.step === "approval" && !g.approval) out.push({ key: approverFor(g, r) === "ho" ? "gr.block.ho" : "gr.block.cop" });
  if (g.step === "implementation") {
    const owed = Math.max(0, g.investment - g.value);
    if (contributed(g) < owed) out.push({ key: "gr.block.contribution", vars: { have: Math.round(contributed(g)).toLocaleString("en-US"), need: Math.round(owed).toLocaleString("en-US") } });
    // In-kind: the equipment is bought by the project, so it closes out only once it has arrived.
    if (g.type === "inKind" && procs) {
      if (!procs.length) out.push({ key: "gr.block.noProc" });
      else for (const p of procs) if (!p.received) out.push({ key: "gr.block.notReceived", vars: { id: p.id } });
    }
  }
  return out;
}

/** The step after this one in the project's own list; null at the end. */
export function nextStepOf(step: GrantStep, s: StepSettings): GrantStep | null {
  const list = stepsIn(s);
  const i = list.indexOf(step);
  if (i < 0) return list.find((x) => GRANT_STEPS.indexOf(x) > GRANT_STEPS.indexOf(step)) ?? null;
  return list[i + 1] ?? null;
}

/** Days a card has sat in its column, by the calendar. */
export const daysSince = (since: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86400000));
/** A card waiting longer than this in one step is shown as stuck. */
export const STUCK_DAYS = 14;
export const isStuck = (since: string | null | undefined, today: string) => !!since && daysSince(since, today) > STUCK_DAYS;

const usd = z.number().min(0).max(1e9);
export const grantFields = z
  .object({
    business: z.string().trim().min(2, "Name the business, association or group.").max(160),
    province: z.string().trim().max(80).default(""),
    type: z.enum(GRANT_TYPES),
    purpose: z.string().trim().max(1000).default(""),
    value: usd,
    investment: usd,
    womenOwned: z.boolean().default(false),
    activity: z.string().trim().max(30).nullable().default(null),
    budgetLine: z.string().trim().max(40).nullable().default(null),
  })
  .refine((f) => f.investment === 0 || f.investment >= f.value, { message: "The whole investment includes the project's share, so it cannot be smaller.", path: ["investment"] });
export type GrantFields = z.infer<typeof grantFields>;

const id = z.string().regex(/^G-\d{3,4}$/);
const reason = z.string().trim().min(10, "Say why, in a sentence: it is kept with the grant.").max(1000);
export const grantAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), fields: grantFields }),
  z.object({ action: z.literal("edit"), id, rev: z.number().int(), fields: grantFields }),
  z.object({ action: z.literal("check"), id, rev: z.number().int(), item: z.string().max(40), done: z.boolean(), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("approve"), id, rev: z.number().int() }),
  z.object({ action: z.literal("advance"), id, rev: z.number().int() }),
  z.object({ action: z.literal("contribution"), id, rev: z.number().int(), amount: z.number().positive().max(1e9), proof: z.string().trim().min(3, "Say what proves it: an invoice, a transfer, photos.").max(300) }),
  z.object({ action: z.literal("link"), id, rev: z.number().int(), procurement: z.string().regex(/^[A-Z0-9-]{3,40}$/) }),
  z.object({ action: z.literal("close"), id, rev: z.number().int(), outcome: z.enum(["rejected", "withdrawn"]), reason }),
  z.object({ action: z.literal("reopen"), id, rev: z.number().int(), reason }),
  z.object({
    action: z.literal("steps"),
    names: z.record(z.enum(GRANT_STEPS), z.string().trim().max(60)),
    skip: z.array(z.enum(GRANT_STEPS)).max(GRANT_STEPS.length),
    source: z.string().trim().max(200).default(""),
  }),
]);
export type GrantAction = z.infer<typeof grantAction>;

/** Board columns: the project's steps, then the closed ones (rejected or withdrawn) folded at the end. Finished grants stay in Closeout, marked done. */
export function grantColumns(items: Grant[], s: StepSettings) {
  const steps = stepsIn(s);
  const cols = steps.map((step) => ({ id: step as string, items: items.filter((g) => (g.status === "open" || g.status === "done") && (g.step === step || (!steps.includes(g.step) && nextStepOf(g.step, s) === step))) }));
  cols.push({ id: "closed", items: items.filter((g) => g.status === "rejected" || g.status === "withdrawn") });
  return cols;
}
