import { z } from "zod";

/**
 * The HR record, built only from the append-only ledger (hr_ledger). Nothing here is stored as
 * "current state": every view is recomputed from the entries, and every entry is checked again
 * as it is read, so an entry written around the app (for example straight into the database)
 * by someone who was not allowed to make it is shown as ignored instead of taking effect.
 *
 * Who may approve what is itself in the ledger (the "rules" entries), so changing an approver,
 * or giving someone the CEO role, needs the same approvals as any other change.
 */

/* ---------------- Roles and rules ---------------- */

export const HR_ROLES = ["hr", "payroll", "cfo", "ceo", "board"] as const;
export type HrRole = (typeof HR_ROLES)[number];
export const ROLE_LABEL: Record<HrRole, string> = { hr: "HR", payroll: "Payroll", cfo: "CFO", ceo: "CEO", board: "Board" };

/** What kind of change a proposal is; each kind has its own approval steps. */
export const CHANGE_KINDS = ["hire", "pay", "job", "details", "separate", "unrelate", "payroll", "rules"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const KIND_LABEL: Record<ChangeKind, string> = {
  hire: "New person",
  pay: "Pay and allowances",
  job: "Job, dates and supervisor",
  details: "Contact details",
  separate: "Leaving ROP",
  unrelate: "Remove a related-party link",
  payroll: "Monthly payroll",
  rules: "Approval rules and role holders",
};

export type Rules = {
  /** Approval steps per kind of change, in order. Each step is signed by a different person. */
  steps: Record<ChangeKind, HrRole[]>;
  /** Who holds each role. */
  holders: Record<HrRole, string[]>;
};

/** Steps when nothing else is set: HR prepares, the CFO checks money, the CEO approves; the Board approves rule changes. */
export const DEFAULT_STEPS: Rules["steps"] = {
  hire: ["cfo", "ceo"],
  pay: ["cfo", "ceo"],
  job: ["ceo"],
  details: ["hr"],
  separate: ["ceo"],
  unrelate: ["ceo"],
  payroll: ["cfo", "ceo"],
  rules: ["ceo", "board"],
};

/** When everyone holding a step's role has a conflict, the step falls to the Board. */
export const FALLBACK: HrRole = "board";

/* ---------------- The employee record ---------------- */

export const FIELDS = {
  name: { label: "Full name", group: "job", type: "text" },
  title: { label: "Job title", group: "job", type: "text" },
  office: { label: "Office", group: "job", type: "select", options: ["Home Office", "Afghanistan", "Guatemala"] },
  employment: { label: "Employment type", group: "job", type: "select", options: ["Employee", "Contractor", "Expatriate", "National staff"] },
  supervisor: { label: "Supervisor", group: "job", type: "person" },
  startDate: { label: "Start date", group: "job", type: "date" },
  contractEnd: { label: "Contract end", group: "job", type: "date" },
  payBasis: { label: "Paid per", group: "pay", type: "select", options: ["Month", "Day", "Hour"] },
  pay: { label: "Pay rate", group: "pay", type: "money" },
  currency: { label: "Currency", group: "pay", type: "select", options: ["USD", "AFN"] },
  dangerPay: { label: "Danger pay (% of daily rate)", group: "pay", type: "number" },
  postDiff: { label: "Post differential (% of daily rate)", group: "pay", type: "number" },
  commsAllowance: { label: "Communications allowance per month", group: "pay", type: "money" },
  livingAllowance: { label: "Living allowance per month", group: "pay", type: "money" },
  retirementPct: { label: "403(b) employee contribution (%)", group: "pay", type: "number" },
  adpId: { label: "ADP employee ID", group: "pay", type: "text" },
  bankAccount: { label: "Bank account for salary", group: "pay", type: "text" },
  phone: { label: "Phone", group: "details", type: "text" },
  emergencyContact: { label: "Emergency contact", group: "details", type: "text" },
} as const;
export type FieldKey = keyof typeof FIELDS;
export type Group = "job" | "pay" | "details";
export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];
export const GROUP_LABEL: Record<Group, string> = { job: "Job", pay: "Pay", details: "Contact" };
export const fieldsIn = (g: Group) => FIELD_KEYS.filter((k) => FIELDS[k].group === g);
/** Needed before a new person's record can be proposed. */
export const HIRE_REQUIRED: FieldKey[] = ["name", "title", "office", "employment", "startDate", "payBasis", "pay", "currency"];

export type Value = string | number | null;
export type Fields = Partial<Record<FieldKey, Value>>;

/* ---------------- Ledger entries ---------------- */

export type Entry = { n: number; at: string; actor: string; kind: string; subject: string | null; data: unknown; hash: string; prevHash: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const personId = z.string().regex(/^[a-z0-9-]{2,40}$/);
const value = z.union([z.string().trim().max(300), z.number().finite().min(0).max(1e9), z.null()]);
const fields = z.partialRecord(z.enum(FIELD_KEYS as [FieldKey, ...FieldKey[]]), value);
const money = z.number().finite().min(-1e9).max(1e9);
/** The parts of a payroll line the rules need; the rest of the line is kept as written. */
const payLine = z.looseObject({ person: personId, gross: money, bonus: money, retro: money, vacationPayout: money, medicalReimb: money, expenses: money, advance: money });
export type PayLineCore = z.infer<typeof payLine>;
/**
 * Discretionary amounts: a person whose line has one of these may not sign the run. Expenses are
 * not among them: they come only from expense reports already approved by someone else.
 */
export const adjustedIn = (lines: PayLineCore[]) => lines.filter((l) => l.bonus || l.retro || l.vacationPayout || l.medicalReimb || l.advance).map((l) => l.person);

const rulesSchema = z.object({
  // Partial, so rules written before a kind or role existed still read; missing ones take the defaults.
  steps: z.partialRecord(z.enum(CHANGE_KINDS), z.array(z.enum(HR_ROLES)).min(1).max(4)),
  holders: z.partialRecord(z.enum(HR_ROLES), z.array(personId).max(20)),
});

/** A proposed change, as written in the ledger. Its id is the entry number. */
export const proposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hire"), subject: personId, effective: isoDate, fields, reason: z.string().trim().min(3).max(2000) }),
  z.object({ type: z.literal("update"), subject: personId, effective: isoDate, fields, reason: z.string().trim().min(3).max(2000), corrects: z.number().int().positive().optional() }),
  z.object({ type: z.literal("separate"), subject: personId, effective: isoDate, reason: z.string().trim().min(3).max(2000) }),
  z.object({ type: z.literal("unrelate"), subject: personId, other: personId, effective: isoDate, reason: z.string().trim().min(3).max(2000) }),
  z.object({ type: z.literal("rules"), subject: z.null(), effective: isoDate, rules: rulesSchema, reason: z.string().trim().min(3).max(2000) }),
  /** A month's payroll for one pay group, as calculated by the server (lib/payroll.ts). The effective date is the pay date. */
  z.object({
    type: z.literal("payroll"),
    subject: z.null(),
    effective: isoDate,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    group: z.enum(["Home Office", "Afghanistan"]),
    supplemental: z.boolean(),
    lines: z.array(payLine).max(500),
    reason: z.string().trim().min(3).max(2000),
  }),
]);
export type ProposalInput = z.infer<typeof proposalSchema>;

const approveData = z.object({ proposal: z.number().int().positive(), step: z.number().int().min(0), as: z.enum(HR_ROLES) });
const rejectData = z.object({ proposal: z.number().int().positive(), note: z.string().trim().min(3).max(1000) });
const withdrawData = z.object({ proposal: z.number().int().positive() });
const declareData = z.object({ a: personId, b: personId, relation: z.string().trim().min(2).max(100) });
const startData = z.object({ rules: rulesSchema });
const sealData = z.object({ upTo: z.number().int().positive(), hash: z.string().regex(/^[0-9a-f]{64}$/), sentTo: z.string().max(300).nullable() });

/** What a person can do from the screen. The server turns each into one ledger entry. */
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), proposal: proposalSchema }),
  z.object({ action: z.literal("approve"), proposal: z.number().int().positive() }),
  z.object({ action: z.literal("reject"), proposal: z.number().int().positive(), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("withdraw"), proposal: z.number().int().positive() }),
  /** Anyone declares a person they are related to; HR may record it for two others. */
  z.object({ action: z.literal("declare"), a: personId, b: personId, relation: z.string().trim().min(2).max(100) }),
]);
export type HrAction = z.infer<typeof actionSchema>;

/* ---------------- Folding the ledger ---------------- */

export type Step = { role: HrRole; /** Fell to the Board because everyone holding the role had a conflict. */ fellBack?: boolean };
export type Signature = { step: number; as: HrRole; by: string; at: string; n: number };
export type Status = "pending" | "approved" | "rejected" | "withdrawn";

export type Proposal = ProposalInput & {
  id: number;
  at: string;
  by: string;
  kind: ChangeKind;
  roles: HrRole[];
  signatures: Signature[];
  status: Status;
  closedBy?: { by: string; at: string; note?: string };
  /** Field values before the change, for showing old → new. */
  before: Fields;
};

export type Relation = { a: string; b: string; relation: string; by: string; at: string; n: number };
export type Seal = { n: number; at: string; upTo: number; hash: string; sentTo: string | null };
export type Ignored = { n: number; kind: string; actor: string; why: string };

export type Person = {
  id: string;
  /** Values in effect today. */
  current: Fields;
  /** Approved changes that start later. */
  upcoming: { effective: string; proposal: number; fields: Fields }[];
  separated: { effective: string; reason: string } | null;
};

export type HrState = {
  rules: Rules | null;
  people: Record<string, Person>;
  proposals: Proposal[];
  relations: Relation[];
  seals: Seal[];
  ignored: Ignored[];
  entries: number;
};

const dayOf = (iso: string) => iso.slice(0, 10);
/** Copy of the rules with every kind present, so a missing kind never means "no approval". */
/** Rules as written in the ledger: kinds or roles added later may be missing. */
export type RulesInput = { steps: Partial<Rules["steps"]>; holders: Partial<Rules["holders"]> };
export const fullRules = (r: RulesInput): Rules => {
  const holders: Partial<Rules["holders"]> = r.holders;
  return { steps: { ...DEFAULT_STEPS, ...r.steps } as Rules["steps"], holders: { hr: holders.hr ?? [], payroll: holders.payroll ?? [], cfo: holders.cfo ?? [], ceo: holders.ceo ?? [], board: holders.board ?? [] } };
};

export const kindOf = (p: ProposalInput): ChangeKind => {
  if (p.type !== "update") return p.type;
  const groups = new Set(Object.keys(p.fields).map((k) => FIELDS[k as FieldKey].group));
  return groups.has("pay") ? "pay" : groups.has("job") ? "job" : "details";
};

/** Pairs as a set, either way round. */
export const relatedTo = (relations: Relation[], id: string) => relations.flatMap((r) => (r.a === id ? [r.b] : r.b === id ? [r.a] : []));

/**
 * Why a person may not sign this proposal, or null if they may. These hold whatever the rules say:
 * nobody signs a change to their own record, a related person's, their supervisor's (they report to
 * them), or one they proposed, and nobody signs two steps of the same change.
 */
export function conflictOf(
  u: string,
  p: Pick<Proposal, "subject" | "by" | "signatures"> & { type: string; other?: string; lines?: PayLineCore[] },
  state: Pick<HrState, "people" | "relations">,
): string | null {
  if (u === p.by) return "proposed it";
  if (p.type === "payroll" && p.lines) {
    const adjusted = adjustedIn(p.lines);
    if (adjusted.includes(u)) return "has a bonus or adjustment in this payroll";
    if (adjusted.some((x) => relatedTo(state.relations, u).includes(x))) return "is related to someone with a bonus or adjustment in this payroll";
  }
  if (p.signatures.some((s) => s.by === u)) return "already signed a step";
  const subjects = [p.subject, p.type === "unrelate" ? p.other : null].filter((x): x is string => !!x);
  for (const s of subjects) {
    if (u === s) return "it is their own record";
    if (relatedTo(state.relations, u).includes(s)) return "related to the person";
    if (state.people[u]?.current.supervisor === s) return "reports to the person";
  }
  return null;
}

/** A conflict, said to the person who has it. */
export const toYou = (why: string) =>
  ({
    "proposed it": "you proposed it",
    "already signed a step": "you already signed a step",
    "already signed this report": "you already signed this report",
    "it is their own record": "it is your own record",
    "related to the person": "you are related to the person",
    "reports to the person": "you report to the person",
    "has a bonus or adjustment in this payroll": "you have a bonus or adjustment in this payroll",
    "is related to someone with a bonus or adjustment in this payroll": "you are related to someone with a bonus or adjustment in this payroll",
  })[why] ?? why;

/** The people who may sign the next step now, and which role they sign as. */
export function nextSigners(p: Proposal, state: HrState): { role: HrRole; fellBack: boolean; people: string[]; blocked: { id: string; why: string }[] } | null {
  if (p.status !== "pending" || !state.rules) return null;
  const role = p.roles[p.signatures.length];
  if (!role) return null;
  const rules = fullRules(state.rules);
  const check = (ids: string[]) => {
    const ok: string[] = [];
    const blocked: { id: string; why: string }[] = [];
    for (const id of ids) {
      const why = conflictOf(id, p, state);
      if (why) blocked.push({ id, why });
      else ok.push(id);
    }
    return { ok, blocked };
  };
  const first = check(rules.holders[role]);
  if (first.ok.length || role === FALLBACK) return { role, fellBack: false, people: first.ok, blocked: first.blocked };
  const fb = check(rules.holders[FALLBACK]);
  return { role, fellBack: true, people: fb.ok, blocked: [...first.blocked, ...fb.blocked] };
}

/** Who may propose each kind of change. */
export function mayPropose(u: string, p: ProposalInput, state: HrState): string | null {
  const rules = state.rules && fullRules(state.rules);
  if (!rules) return "The approval rules have not been set up yet.";
  const has = (r: HrRole) => rules.holders[r].includes(u);
  if (p.type === "rules") return HR_ROLES.some(has) ? null : "Only people holding an HR role can propose new rules.";
  if (p.type === "payroll") {
    if (!has("payroll")) return "Only the payroll role prepares a payroll.";
    const same = state.proposals.filter((x) => x.type === "payroll" && x.month === p.month && x.group === p.group);
    if (same.some((x) => x.status === "pending")) return "A payroll for this month and group is already waiting for approval.";
    const paid = same.some((x) => x.status === "approved");
    if (paid !== p.supplemental) return paid ? "This month is already paid: prepare a supplemental payroll for the differences." : "A supplemental payroll needs an approved payroll for the month first.";
    return null;
  }
  const own = p.subject === u;
  // Anyone may correct their own contact details; HR approves.
  if (p.type === "update" && own && kindOf(p) === "details") return null;
  if (!has("hr")) return "Only HR proposes changes to a record.";
  if (own) return "HR cannot propose changes to their own record; another HR officer does.";
  if (p.type === "hire" && state.people[p.subject]) return "This person already has a record.";
  if (p.type !== "hire" && !state.people[p.subject]) return "No record for this person.";
  if (p.type === "update" && !Object.keys(p.fields).length) return "Change at least one field.";
  if (p.type === "hire" && HIRE_REQUIRED.some((k) => p.fields[k] == null || p.fields[k] === "")) return `A new record needs: ${HIRE_REQUIRED.map((k) => FIELDS[k].label).join(", ")}.`;
  if (p.type === "unrelate" && !state.relations.some((r) => (r.a === p.subject && r.b === p.other) || (r.b === p.subject && r.a === p.other))) return "These two people are not linked.";
  if (p.type === "update" && p.corrects) {
    const c = state.proposals.find((x) => x.id === p.corrects);
    if (!c || c.status !== "approved" || c.subject !== p.subject) return "A correction must point to an approved change to the same record.";
  }
  if (state.proposals.some((x) => x.status === "pending" && x.subject === p.subject && x.type === p.type && p.type !== "update")) return "There is already a pending change of this kind for this person.";
  return null;
}

/** Values in effect on a date, from approved changes in order of their effective date. */
function apply(proposals: Proposal[], id: string, on: string) {
  const changes = proposals
    .filter((p) => p.status === "approved" && p.subject === id && (p.type === "hire" || p.type === "update"))
    .sort((a, b) => a.effective.localeCompare(b.effective) || a.id - b.id);
  const current: Fields = {};
  const upcoming: Person["upcoming"] = [];
  for (const c of changes) {
    const f = (c as { fields: Fields }).fields;
    if (c.effective <= on) Object.assign(current, f);
    else upcoming.push({ effective: c.effective, proposal: c.id, fields: f });
  }
  return { current, upcoming };
}

/**
 * Rebuilds the record from the entries, checking each one as if it were being made now.
 * `today` decides which approved changes are in effect.
 */
export function fold(entries: Entry[], today: string): HrState {
  const state: HrState = { rules: null, people: {}, proposals: [], relations: [], seals: [], ignored: [], entries: entries.length };
  const ignore = (e: Entry, why: string) => state.ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why });
  const refresh = (id: string) => {
    const hire = state.proposals.find((p) => p.type === "hire" && p.subject === id && p.status === "approved");
    if (!hire) return;
    const { current, upcoming } = apply(state.proposals, id, today);
    const sep = state.proposals.find((p) => p.type === "separate" && p.subject === id && p.status === "approved");
    state.people[id] = { id, current, upcoming, separated: sep ? { effective: sep.effective, reason: sep.reason } : null };
  };

  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    switch (e.kind) {
      case "start": {
        const d = startData.safeParse(e.data);
        if (!d.success) ignore(e, "unreadable");
        else if (state.rules) ignore(e, "the rules were already set; later changes need approval");
        else state.rules = fullRules(d.data.rules);
        break;
      }
      case "propose": {
        const d = proposalSchema.safeParse(e.data);
        if (!d.success) {
          ignore(e, "unreadable");
          break;
        }
        const why = mayPropose(e.actor, d.data, state);
        if (why) {
          ignore(e, why);
          break;
        }
        const kind = kindOf(d.data);
        const before: Fields = {};
        if (d.data.type === "update") {
          const cur = state.people[d.data.subject]?.current ?? {};
          for (const k of Object.keys(d.data.fields) as FieldKey[]) before[k] = cur[k] ?? null;
        }
        state.proposals.push({ ...d.data, id: e.n, at: e.at, by: e.actor, kind, roles: [...fullRules(state.rules!).steps[kind]], signatures: [], status: "pending", before });
        break;
      }
      case "approve": {
        const d = approveData.safeParse(e.data);
        const p = d.success ? state.proposals.find((x) => x.id === d.data.proposal) : undefined;
        if (!d.success || !p) {
          ignore(e, "no such proposal");
          break;
        }
        const next = nextSigners(p, state);
        if (!next || d.data.step !== p.signatures.length) {
          ignore(e, "not the step waiting for a signature");
          break;
        }
        if (!next.people.includes(e.actor)) {
          ignore(e, conflictOf(e.actor, p, state) ?? `does not hold the ${ROLE_LABEL[next.fellBack ? FALLBACK : next.role]} role`);
          break;
        }
        p.signatures.push({ step: d.data.step, as: next.fellBack ? FALLBACK : next.role, by: e.actor, at: e.at, n: e.n });
        if (p.signatures.length === p.roles.length) {
          p.status = "approved";
          p.closedBy = { by: e.actor, at: e.at };
          if (p.type === "rules") state.rules = fullRules(p.rules);
          if (p.type === "unrelate") state.relations = state.relations.filter((r) => !((r.a === p.subject && r.b === p.other) || (r.b === p.subject && r.a === p.other)));
          if (p.subject) refresh(p.subject);
        }
        break;
      }
      case "reject": {
        const d = rejectData.safeParse(e.data);
        const p = d.success ? state.proposals.find((x) => x.id === d.data.proposal) : undefined;
        if (!d.success || !p || p.status !== "pending") {
          ignore(e, "no pending proposal");
          break;
        }
        const next = nextSigners(p, state);
        if (!next?.people.includes(e.actor)) {
          ignore(e, "only the person who may sign the next step can send it back");
          break;
        }
        p.status = "rejected";
        p.closedBy = { by: e.actor, at: e.at, note: d.data.note };
        break;
      }
      case "withdraw": {
        const d = withdrawData.safeParse(e.data);
        const p = d.success ? state.proposals.find((x) => x.id === d.data.proposal) : undefined;
        if (!d.success || !p || p.status !== "pending" || p.by !== e.actor) {
          ignore(e, "only the proposer withdraws a pending proposal");
          break;
        }
        p.status = "withdrawn";
        p.closedBy = { by: e.actor, at: e.at };
        break;
      }
      case "declare": {
        const d = declareData.safeParse(e.data);
        if (!d.success || d.data.a === d.data.b) {
          ignore(e, "unreadable");
          break;
        }
        const isHr = !!state.rules && fullRules(state.rules).holders.hr.includes(e.actor);
        if (e.actor !== d.data.a && e.actor !== d.data.b && !isHr) {
          ignore(e, "only one of the two people, or HR, declares a link");
          break;
        }
        // Declaring only ever adds a conflict, so it takes effect at once. Removing one needs approval.
        if (!state.relations.some((r) => (r.a === d.data.a && r.b === d.data.b) || (r.a === d.data.b && r.b === d.data.a)))
          state.relations.push({ ...d.data, by: e.actor, at: e.at, n: e.n });
        break;
      }
      case "seal": {
        const d = sealData.safeParse(e.data);
        if (!d.success) ignore(e, "unreadable");
        else state.seals.push({ n: e.n, at: e.at, ...d.data });
        break;
      }
      case "timesheet":
      case "ts-approve":
      case "ts-return":
      case "expense":
      case "ex-approve":
      case "ex-return":
      case "ex-withdraw":
      case "policy":
      case "onboard-start":
      case "onboard-step":
        // Read by foldTimesheets, foldExpenses and foldOnboarding (lib/timesheet.ts, expense.ts, onboarding.ts).
        break;
      default:
        ignore(e, "unknown kind of entry");
    }
  }
  // Effective dates pass with time, so the record is worked out for today at the end.
  for (const id of new Set(state.proposals.filter((p) => p.type === "hire" && p.status === "approved").map((p) => p.subject as string))) refresh(id);
  return state;
}

/* ---------------- Warnings shown to approvers ---------------- */

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/** What an approver should look at twice. */
export function warningsFor(p: Proposal, state: HrState): string[] {
  const out: string[] = [];
  const back = days(dayOf(p.at), p.effective);
  if (back > 0 && p.type !== "rules" && p.type !== "payroll") out.push(`Backdated: takes effect ${back} day${back === 1 ? "" : "s"} before it was proposed.`);
  if (p.type === "update" || p.type === "hire") {
    const f = p.fields;
    const was = p.before.pay;
    if (typeof f.pay === "number" && typeof was === "number" && was > 0) {
      const pct = Math.round(((f.pay - was) / was) * 1000) / 10;
      if (pct !== 0) out.push(`Pay ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}%.`);
      if (pct >= 10) out.push("A raise of 10% or more.");
    }
    if (f.currency !== undefined && p.before.currency && f.currency !== p.before.currency) out.push("Currency changes.");
    if (p.type === "update" && p.corrects) out.push(`Corrects change #${p.corrects}.`);
    if (f.startDate !== undefined && p.before.startDate && f.startDate !== p.before.startDate) out.push("Changes the start date, which changes length of service on employment letters.");
    if (f.title !== undefined && p.before.title && back > 0) out.push("A backdated title change shows on employment letters for the past.");
  }
  if (p.type === "payroll") {
    const lines = p.lines as (PayLineCore & { name?: string; problems?: string[] })[];
    const withProblems = lines.filter((l) => l.problems?.length);
    if (withProblems.length) out.push(`${withProblems.length} of ${lines.length} lines have something to check: ${withProblems.map((l) => l.name ?? l.person).join(", ")}.`);
    const adjusted = adjustedIn(lines);
    if (adjusted.length) out.push(`Bonuses or adjustments for ${adjusted.map((x) => lines.find((l) => l.person === x)?.name ?? x).join(", ")}.`);
    if (p.supplemental) out.push("A supplemental payroll: paid on top of the month's approved payroll.");
  }
  if (p.type === "rules") {
    const cur = state.rules;
    if (cur)
      for (const r of HR_ROLES) {
        const added = p.rules.holders[r]?.filter((x) => !cur.holders[r].includes(x)) ?? [];
        if (added.length) out.push(`Gives the ${ROLE_LABEL[r]} role to ${added.join(", ")}.`);
      }
  }
  return out;
}

/* ---------------- Who sees what ---------------- */

export function rolesOf(u: string, state: HrState): HrRole[] {
  const rules = state.rules && fullRules(state.rules);
  return rules ? HR_ROLES.filter((r) => rules.holders[r].includes(u)) : [];
}

/** Anyone holding an HR role sees every record. Admins do not, unless they hold a role. */
export const seesAll = (u: string, state: HrState) => rolesOf(u, state).length > 0;

/** A supervisor sees their team's job details, never their pay or contacts. */
export function visibleFields(viewer: string, person: string, state: HrState): Group[] {
  if (viewer === person || seesAll(viewer, state)) return ["job", "pay", "details"];
  if (state.people[person]?.current.supervisor === viewer) return ["job"];
  return [];
}

export const pick = (f: Fields, groups: Group[]): Fields => Object.fromEntries(Object.entries(f).filter(([k]) => groups.includes(FIELDS[k as FieldKey].group)));

/* ---------------- Checking the chain ---------------- */

export type Integrity = { ok: boolean; entries: number; brokenAt: number | null; problem: string | null; lastSeal: Seal | null; unsealed: number };
