/**
 * Field activities: roles, steps, checks, farmer profiles and synthetic records.
 * Steps follow docs/ROP-END-TO-END-WORKFLOW-DRAFT.md §2 (farm preparation to MEL follow-up).
 */

import type { Issue, TimelineEvent } from "@/components/workspace/ui";
import { ORG_ID, PROJECT, TODAY, holderOf, projectPath, stepHistory, type AppUser, type FieldRole } from "@/lib/demo";
import { today } from "@/lib/clock";
import { DEMO_SETUP, itemsFor, packageUsd, qtyUnit, type FieldSetup } from "@/lib/package";

export type { FieldRole };

export const fieldRoles: { id: FieldRole; label: string; short: string }[] = [
  { id: "extension", label: "Extension agent", short: "Extension" },
  { id: "mel", label: "MEL officer", short: "MEL" },
  { id: "store", label: "Distribution staff", short: "Distribution" },
  { id: "manager", label: "Project manager", short: "Management" },
];
export const fieldRoleLabel = (r: string) => fieldRoles.find((x) => x.id === r)?.label ?? r;
/** "Farida Noori (Extension agent)" for a role. */
export const fieldPerson = (r: string) => {
  const u = holderOf("field", r);
  return u ? `${u.name} (${fieldRoleLabel(r)})` : fieldRoleLabel(r);
};

export const SEASON = { name: PROJECT.season, crop: "Maize", village: "Village B", windowEnd: "2027-03-20" };

/** The demo project's package value per farmer (A-2027 records). Other projects: lib/package packageUsd. */
export const PACKAGE_USD = packageUsd(DEMO_SETUP);

/** What is in the store, by package item key, in each item's unit. */
export type Stock = Record<string, number>;
export const seedStock = (): Stock => ({ seed: 380, npk: 600 });

export type Survey = { date: string; score: number; comment: string; by: string };
export type Photo = { id: string; activity: PhotoKind; date: string; caption: string; src?: string };
export type PhotoKind = "training" | "landprep" | "visit" | "distribution" | "planting";
export type Story = { id: string; status: "note" | "completed"; title: string; text: string; date: string; by: string };

export type Gender = "Female" | "Male";
export type AgeBand = "18–29 (youth)" | "30–49" | "50+";

export type Farmer = {
  kind: "farmer";
  orgId: string;
  id: string;
  /** Personal data. Shown only to people with participant-data access; AI agents never see it. */
  name: string;
  gender: Gender;
  ageBand: AgeBand;
  householdSize: number;
  community: string;
  hectares: number;
  enrolled: boolean;
  enrolledOn: string;
  contributionPaid: boolean;
  step: string;
  checks: Record<string, boolean>;
  deadline?: string;
  correction?: string;
  issues: Issue[];
  timeline: TimelineEvent[];
  surveys: Survey[];
  photos: Photo[];
  stories: Story[];
  /**
   * An input distribution recorded for this farmer and not yet approved (server-set, from
   * server/distribution): waiting for the project manager, or sent back to be fixed. The farmer
   * stays at "distribute" until it is approved, from the app or from KoboCollect alike.
   */
  awaiting?: { id: string; status: "pending" | "sent_back"; note?: string };
  /** The saved version this copy was read at (server-set, never stored in the record). */
  rev?: string;
};

export type Finding = {
  kind: "finding";
  orgId?: string;
  id: string;
  title: string;
  summary: string;
  sources: string[];
  step: string;
  checks: Record<string, boolean>;
  ai?: string[];
  action?: { text: string; owner: FieldRole; due: string };
  issues: Issue[];
  timeline: TimelineEvent[];
  /** The saved version this copy was read at (server-set, never stored in the record). */
  rev?: string;
};

export type FieldItem = Farmer | Finding;
/**
 * What the checks need beyond the record. `stockNote`: when the store's stock comes from purchases
 * and the next package cannot go out, why, and what unblocks it. `setup`: the project's package and
 * season. `today`: the project's today (the demo date on the demo project).
 */
export type Ctx = { stock: Stock; stockNote?: string | null; setup: FieldSetup; today: string };

export type SCheck = {
  id: string;
  label: string;
  why: string;
  tag?: string;
  auto?: (i: FieldItem, ctx: Ctx) => { ok: boolean; detail: string } | null;
  ai?: boolean;
  fix?: string;
  resolve?: string;
  /** The history line once the fix is recorded ("Contribution received"); the button label when absent. */
  resolveDone?: string;
  /** What recording the fix changes on the record. Without it, the check is marked as fixed. */
  resolveEffect?: (i: FieldItem) => FieldItem;
};

export type Outcome = {
  label: string;
  to: string;
  done: string;
  tone: "primary" | "danger" | "quiet";
  /** Placeholder for the required note; omit when no note is needed. */
  note?: string;
  /** Default true: every check must pass first. */
  requiresChecks?: boolean;
  effect?: (i: FieldItem, note: string, ctx: Ctx) => { item: FieldItem; stock?: Stock };
};

export type SStep = {
  id: string;
  stage: number;
  title: string;
  owner: FieldRole | "action-owner";
  note?: (i: FieldItem) => string | undefined;
  checks: SCheck[];
  outcomes: Outcome[];
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const asFarmer = (i: FieldItem) => i as Farmer;

export const farmerStages = ["Train", "Prepare land", "Readiness", "Inputs", "Plant", "Season record"];
export const findingStages = ["Validate", "Decide", "Act", "Next season"];

export const fieldSteps: Record<string, SStep> = {
  train: {
    id: "train",
    stage: 0,
    title: "Train for land preparation",
    owner: "extension",
    checks: [
      {
        id: "enrolled",
        label: "Enrolled in the program",
        why: "Farmers must have enrolled officially before program training.",
        tag: "TS",
        auto: (i) => ({ ok: asFarmer(i).enrolled, detail: asFarmer(i).enrolled ? `Enrollment recorded ${asFarmer(i).enrolledOn}` : "No enrollment record" }),
      },
      {
        id: "contribution",
        label: "Agreed contribution paid",
        why: "The farmer contribution is collected after selection and before program entry or training.",
        tag: "TS",
        auto: (i) => ({ ok: asFarmer(i).contributionPaid, detail: asFarmer(i).contributionPaid ? "Contribution received" : "Not yet received" }),
        resolve: "Record contribution received",
        resolveDone: "Contribution received",
        resolveEffect: (i) => ({ ...asFarmer(i), contributionPaid: true }),
      },
      { id: "attended", label: "Attended classroom and field training", why: "Crop-stage training: here, land preparation and planting.", tag: "TS" },
      { id: "register", label: "Attendance register reference recorded", why: "Paper counts as source evidence. Record who completed it, when, and where the original is kept.", tag: "TS" },
    ],
    outcomes: [{ label: "Record training", to: "prepare", done: "Training recorded", tone: "primary" }],
  },
  prepare: {
    id: "prepare",
    stage: 1,
    title: "Prepare the plot",
    owner: "extension",
    checks: [
      { id: "plot", label: "Plot agreed and located (GPS or sketch)", why: "The plot is linked to farmer, crop, season and project.", tag: "TS" },
      { id: "spec", label: "Farmer reports land prepared to the technical spec", why: "Clearing, ridges and spacing as trained. The joint visit confirms it.", tag: "TS" },
    ],
    outcomes: [{ label: "Request readiness visit", to: "verify", done: "Readiness visit requested", tone: "primary" }],
  },
  verify: {
    id: "verify",
    stage: 2,
    title: "Verify readiness",
    owner: "mel",
    note: () => "Joint site visit. Inputs move only on Yes.",
    checks: [
      { id: "joint", label: "Extension agent and MEL both at the plot", why: "Readiness is verified jointly so the technical and evidence views agree.", tag: "TS" },
      { id: "form", label: "Standard field-visit form completed", why: "The same form for every plot keeps findings comparable.", tag: "TS" },
      { id: "photo", label: "Photo or paper form reference attached", why: "Evidence reference for the yes/no finding.", tag: "TS" },
    ],
    outcomes: [
      { label: "Ready: Yes", to: "distribute", done: "Readiness: Yes", tone: "primary" },
      {
        label: "Not ready: No",
        to: "correct",
        done: "Readiness: No",
        tone: "danger",
        note: "What needs fixing?",
        effect: (i, note, ctx) => ({ item: { ...asFarmer(i), deadline: addDays(ctx.today, 7), correction: note } }),
      },
    ],
  },
  correct: {
    id: "correct",
    stage: 2,
    title: "Correct and recheck",
    owner: "extension",
    note: (i) => (asFarmer(i).correction ? `To fix: ${asFarmer(i).correction}` : undefined),
    checks: [
      { id: "explained", label: "Corrective action explained to the farmer", why: "The farmer gets a defined opportunity and deadline to fix the issue.", tag: "TS" },
      {
        id: "deadline",
        label: "Recheck is within the deadline",
        why: "If the issue is unresolved by the deadline, the farmer is removed. Expected to be rare after contribution.",
        tag: "TS",
        auto: (i, ctx) => {
          const d = asFarmer(i).deadline;
          if (!d) return null;
          const left = daysBetween(ctx.today, d);
          return { ok: left >= 0, detail: left >= 0 ? `Deadline ${d} · ${left} days left` : `Deadline ${d} passed ${-left} days ago` };
        },
      },
      { id: "recheck", label: "Recheck visit done and form completed", why: "Same standard form as the first visit.", tag: "TS" },
    ],
    outcomes: [
      { label: "Recheck: Yes", to: "distribute", done: "Recheck: Yes", tone: "primary" },
      { label: "Still not ready", to: "removal", done: "Recheck: No, sent for decision", tone: "danger", note: "What is still wrong?", requiresChecks: false },
    ],
  },
  removal: {
    id: "removal",
    stage: 2,
    title: "Decide: remove or extend",
    owner: "manager",
    note: (i) => `Correction: ${asFarmer(i).correction ?? "not recorded"}. Removal follows local rules.`,
    checks: [
      { id: "history", label: "Correction history reviewed", why: "Issue, deadline, recheck result and decisions are on the record below.", tag: "TS" },
      { id: "rules", label: "Local rules on removal followed", why: "Project authority confirms removal per local rules.", tag: "TS; OPEN roles" },
    ],
    outcomes: [
      { label: "Confirm removal", to: "removed", done: "Removed from the project", tone: "danger", note: "Reason for the record" },
      {
        label: "Extend 7 days",
        to: "correct",
        done: "Deadline extended 7 days",
        tone: "quiet",
        requiresChecks: false,
        effect: (i, _, ctx) => ({ item: { ...asFarmer(i), deadline: addDays(ctx.today, 7) } }),
      },
    ],
  },
  distribute: {
    id: "distribute",
    stage: 3,
    title: "Distribute the input package",
    owner: "store",
    checks: [
      {
        id: "stock",
        label: "Package in stock at the store",
        why: "Inputs come from procurement, on the package's budget lines. Stock falls as packages go out.",
        tag: "TS",
        auto: (i, ctx) => {
          const need = itemsFor(ctx.setup, asFarmer(i).hectares);
          const ok = need.every((p) => (ctx.stock[p.key] ?? 0) + 1e-9 >= p.qty);
          return {
            ok,
            // When short, the store's own reason says what is missing and what would unblock it.
            detail: !ok && ctx.stockNote ? ctx.stockNote : need.map((p) => `${p.item}: needs ${qtyUnit(p.qty, p.unit)}, ${qtyUnit(ctx.stock[p.key] ?? 0, p.unit)} in store`).join(" · "),
          };
        },
        fix: "Store is short for this package: check the procurement status.",
      },
      { id: "recipient", label: "Recipient confirmed by signature or thumbprint", why: "Recipient, quantities and date are recorded together.", tag: "TS" },
      { id: "voucher", label: "Store issue voucher number recorded", why: "Links the distribution to expenditure evidence on the package's budget lines.", tag: "TS" },
    ],
    outcomes: [
      {
        label: "Record distribution",
        to: "plant",
        done: "Inputs distributed",
        tone: "primary",
        effect: (i, _, ctx) => ({
          item: i,
          stock: { ...ctx.stock, ...Object.fromEntries(itemsFor(ctx.setup, asFarmer(i).hectares).map((p) => [p.key, Math.max(0, (ctx.stock[p.key] ?? 0) - p.qty)])) },
        }),
      },
    ],
  },
  plant: {
    id: "plant",
    stage: 4,
    title: "Plant and follow up",
    owner: "extension",
    checks: [
      {
        id: "window",
        label: "Planted within the planting window",
        why: "The targeted crop at the right time.",
        tag: "TS",
        auto: (_, ctx) => {
          const end = ctx.setup.windowEnd;
          if (!end) return null;
          const left = daysBetween(ctx.today, end);
          return { ok: left >= 0, detail: left >= 0 ? `Window closes ${end} · ${left} days left` : `Window closed ${end}` };
        },
      },
      { id: "manner", label: "Planted at the right spacing and depth", why: "The right manner, as trained.", tag: "TS" },
      { id: "followup", label: "Follow-up visit form completed with MEL", why: "Technical and MEL teams complete the standard follow-up form.", tag: "TS" },
    ],
    outcomes: [{ label: "Record planting", to: "complete", done: "Planting recorded", tone: "primary" }],
  },
  validate: {
    id: "validate",
    stage: 0,
    title: "Validate the finding",
    owner: "mel",
    checks: [
      {
        id: "sources",
        label: "Linked to source records",
        why: "Every finding traces back to the field records it came from.",
        tag: "TS",
        auto: (i) => {
          const s = (i as Finding).sources;
          return { ok: s.length > 0, detail: s.length ? `${s.length} farmer records: ${s.join(", ")}` : "No source records linked" };
        },
      },
      { id: "aiSummary", label: "AI summary checked against the source forms", why: "AI may organize records and draft analysis. MEL validates evidence and interpretation.", tag: "TS", ai: true },
      { id: "interpretation", label: "Interpretation agreed within MEL", why: "MEL prepares and validates the analysis before management sees it.", tag: "TS" },
    ],
    outcomes: [{ label: "Send to management", to: "decide", done: "Validated and sent to management", tone: "primary" }],
  },
  decide: {
    id: "decide",
    stage: 1,
    title: "Decide what to do",
    owner: "manager",
    checks: [{ id: "read", label: "Evidence summary reviewed", why: "Management reviews validated findings, then sets adjustments, owners and deadlines.", tag: "TS" }],
    outcomes: [{ label: "No action needed", to: "closed", done: "Closed: no action needed", tone: "quiet", note: "Why no action?" }],
  },
  act: {
    id: "act",
    stage: 2,
    title: "Carry out the action",
    owner: "action-owner",
    note: (i) => {
      const a = (i as Finding).action;
      return a ? `${a.text} · due ${a.due}` : undefined;
    },
    checks: [
      { id: "doneIt", label: "Action carried out", why: "The owner reports back against the due date.", tag: "TS" },
      { id: "evidence", label: "Evidence recorded", why: "So the learning can carry into the next seasonal plan.", tag: "TS" },
    ],
    outcomes: [{ label: "Mark done", to: "closed", done: "Action done: feeds the next season plan", tone: "primary" }],
  },
};

/**
 * Why a farmer's record may not be saved at the step it was sent with; null when it may. A farmer
 * moves only along the workflow: from the step the database holds to one of that step's outcomes.
 * The screen already works this way; the server checks it too, so an old tab left open cannot put
 * a farmer back at a step they have passed (and have inputs handed out twice), and nothing can
 * jump a farmer past the readiness check or the goods-received check.
 */
export function moveProblem(stored: string | undefined, item: Pick<FieldItem, "id" | "kind" | "step">): string | null {
  if (item.kind !== "farmer") return null;
  const name = (step: string) => fieldSteps[step]?.title ?? step;
  if (stored === undefined) return item.step === "train" ? null : `${item.id} is not on this project's farmer list, so it cannot be saved at "${name(item.step)}". Add farmers from the farmer list.`;
  if (stored === item.step) return null;
  if (fieldSteps[stored]?.outcomes.some((o) => o.to === item.step)) return null;
  return `${item.id} is at "${name(stored)}" and cannot be saved as "${name(item.step)}". Someone may have updated this farmer since you opened the page: reload and try again.`;
}

export const ownerOfItem = (i: FieldItem): FieldRole | null => {
  const s = fieldSteps[i.step];
  if (!s) return null;
  if (s.owner === "action-owner") return i.kind === "finding" ? (i.action?.owner ?? "manager") : null;
  return s.owner;
};

export function fieldCheck(i: FieldItem, c: SCheck, ctx: Ctx) {
  const r = c.auto?.(i, ctx);
  if (r && !r.ok && i.checks[`fix.${i.step}.${c.id}`]) return { ok: true, auto: true, detail: `${r.detail} · ${c.resolve}` };
  if (r) return { ok: r.ok, auto: true, detail: r.detail };
  return { ok: !!i.checks[`${i.step}.${c.id}`], auto: false };
}

/**
 * Why this person may not move an item from the step the database holds to the one sent, or null
 * when they may. The same rules the screen applies, checked again on the server: the step's owner
 * moves it, along one of its outcomes, with its checks passing (unless the outcome is one that
 * goes ahead without them) and no blocking issue open.
 */
export function stepRefusal(stored: FieldItem, sent: FieldItem, roles: readonly string[], ctx: Ctx): string | null {
  if (stored.step === sent.step) return null;
  const step = fieldSteps[stored.step];
  const waiting = stored.kind === "farmer" ? stored.awaiting : undefined;
  if (waiting) return `${sent.id}'s input distribution is already recorded and ${waiting.status === "pending" ? "waiting for the project manager to approve it" : "was sent back to be fixed; fix it from its approval page"}. The farmer moves on once it is approved.`;
  const outcome = step?.outcomes.find((o) => o.to === sent.step);
  const label = sent.kind === "farmer" ? sent.id : `Finding ${sent.id}`;
  if (!step || !outcome) return null; // moveProblem refuses moves off the workflow
  const owner = ownerOfItem(stored);
  if (!owner || !roles.includes(owner)) return `${label}: "${step.title}" is for the ${fieldRoleLabel(owner ?? "")} to record. Ask them, or reload if someone already has.`;
  // Judged on the record as sent, at the step it is leaving.
  const at = { ...sent, step: stored.step } as FieldItem;
  if (openBlocking(at).length) return `${label}: a blocking issue is still open on "${step.title}". Resolve it first.`;
  if (outcome.requiresChecks !== false) {
    const missing = step.checks.filter((c) => !fieldCheck(at, c, ctx).ok).map((c) => c.label);
    if (missing.length) return `${label} cannot be recorded as "${outcome.done}" yet. Not done: ${missing.join("; ")}.`;
  }
  return null;
}

export const openBlocking = (i: FieldItem) => i.issues.filter((x) => x.status === "open" && x.blocking);
export const allChecksPass = (i: FieldItem, ctx: Ctx) => {
  const s = fieldSteps[i.step];
  return !!s && s.checks.every((c) => fieldCheck(i, c, ctx).ok);
};

/** Remaining steps on the expected (Yes) path, for projecting who gets the item next and when. */
export function remainingPath(i: FieldItem): { step: string; owner: string }[] {
  const order =
    i.kind === "farmer"
      ? { train: ["train", "prepare", "verify", "distribute", "plant"], prepare: ["prepare", "verify", "distribute", "plant"], verify: ["verify", "distribute", "plant"], correct: ["correct", "distribute", "plant"], removal: ["removal"], distribute: ["distribute", "plant"], plant: ["plant"] }[i.step]
      : { validate: ["validate", "decide", "act"], decide: ["decide", "act"], act: ["act"] }[i.step];
  return (order ?? []).map((s) => ({
    step: s,
    owner: fieldSteps[s].owner === "action-owner" ? (i.kind === "finding" && i.action ? i.action.owner : "extension") : (fieldSteps[s].owner as string),
  }));
}

export function projectItem(i: FieldItem) {
  const now = today();
  const since = i.timeline.length ? i.timeline[i.timeline.length - 1].date : now;
  return projectPath(remainingPath(i), since, now);
}

export const historyBasis = (step: string) => {
  const h = stepHistory[step];
  return h ? `Median ${h.median} days across ${h.n} past cases` : "";
};

export const issueTypes = ["Field issue", "Evidence gap", "Needs a decision"];
export const issueHelp: Record<string, string> = {
  "Field issue": "Something on the plot or with the farmer that is holding this step.",
  "Evidence gap": "A form, photo or paper record is missing or does not match.",
  "Needs a decision": "Someone with authority has to decide before this can move.",
};
export const ISSUE_FOOTNOTE = "A farmer complaint or a safeguarding concern? Do not record it here. Use the project's grievance mechanism.";

export const photoLabels: Record<PhotoKind, string> = {
  training: "Training",
  landprep: "Land preparation",
  visit: "Readiness visit",
  distribution: "Input distribution",
  planting: "Planting",
};

/* ---------- participant privacy ---------- */

/** Farmer IDs everywhere; the name only for people with participant-data access. */
export const farmerLabel = (f: { id: string; name: string }, u: AppUser | null | undefined) => (u?.pii && f.name ? `${f.name} · ${f.id}` : `Farmer ${f.id}`);
export const farmerName = (f: { id: string; name: string }, u: AppUser | null | undefined) => (u?.pii && f.name ? f.name : `Farmer ${f.id}`);
/** Replaces a farmer's name in free text (e.g. a story) for people without access. */
export const maskName = (text: string, f: { id: string; name: string }, u: AppUser | null | undefined) =>
  u?.pii || !f.name ? text : text.split(f.name).join(`Farmer ${f.id}`);

/* ---------- synthetic records ---------- */

const DEMOGRAPHICS: Record<string, [Gender, AgeBand, number]> = {
  "F-0001": ["Male", "50+", 9],
  "F-0002": ["Male", "30–49", 7],
  "F-0003": ["Female", "30–49", 6],
  "F-0004": ["Male", "18–29 (youth)", 4],
  "F-0005": ["Male", "18–29 (youth)", 5],
  "F-0007": ["Female", "30–49", 8],
  "F-0008": ["Female", "18–29 (youth)", 5],
  "F-0009": ["Female", "30–49", 7],
  "F-0011": ["Male", "50+", 10],
  "F-0012": ["Female", "50+", 6],
  "F-0014": ["Male", "30–49", 7],
};

const farmerPath = ["train", "prepare", "verify", "distribute", "plant"];
const owners: Record<string, FieldRole> = { train: "extension", prepare: "extension", verify: "mel", distribute: "store", plant: "extension" };
const photoFor: Record<string, PhotoKind> = { train: "training", prepare: "landprep", verify: "visit", distribute: "distribution", plant: "planting" };

function farmer(
  id: string,
  name: string,
  hectares: number,
  step: string,
  extra: Partial<Farmer> = {},
  doneChecks: string[] = [],
  scores: number[] = [4, 4],
): Farmer {
  const pathStep = step === "correct" || step === "removal" ? "distribute" : step === "complete" ? "complete" : step;
  const reached = pathStep === "complete" ? farmerPath.length : farmerPath.indexOf(pathStep);
  const timeline: TimelineEvent[] = [];
  const photos: Photo[] = [];
  const checks: Record<string, boolean> = {};
  farmerPath.slice(0, reached).forEach((s, k) => {
    fieldSteps[s].checks.forEach((c) => (checks[`${s}.${c.id}`] = true));
    const outcome = s === "verify" && (step === "correct" || step === "removal") ? "Readiness: No" : fieldSteps[s].outcomes[0].done;
    const date = addDays(TODAY, -(reached - k) * 5);
    timeline.push({ date, who: owners[s], what: outcome });
    if (s !== "verify" || k % 2 === 0) photos.push({ id: `${id}-${s}`, activity: photoFor[s], date, caption: `${fieldSteps[s].title} · ${id}` });
  });
  if (step === "removal") timeline.push({ date: addDays(TODAY, -2), who: "extension", what: "Recheck: No, sent for decision" });
  doneChecks.forEach((c) => (checks[`${step}.${c}`] = true));
  const happy = ["Happy with the visits; staff explain things well.", "Seed arrived on time.", "Training was clear and practical."];
  const unsure = ["Would like more help with ridge spacing.", "Worried about water for the lower field.", "Visits feel rushed."];
  // Surveys roughly every two months, the latest a few days before the demo date.
  const surveys: Survey[] = scores.map((score, k) => ({
    date: addDays(TODAY, -5 - (scores.length - 1 - k) * 60),
    score,
    comment: (score >= 4 ? happy : unsure)[(id.charCodeAt(5) + k) % 3],
    by: "mel",
  }));
  const demo = DEMOGRAPHICS[id] ?? ["Male", "30–49", 6];
  return {
    kind: "farmer",
    orgId: ORG_ID,
    id,
    name,
    gender: demo[0],
    ageBand: demo[1],
    householdSize: demo[2],
    community: "Village B",
    hectares,
    enrolled: true,
    enrolledOn: "2026-11-02",
    contributionPaid: true,
    step,
    checks,
    issues: [],
    timeline,
    surveys,
    photos,
    stories: [],
    ...extra,
  };
}

function finding(f: Omit<Finding, "kind" | "checks" | "issues" | "timeline"> & { history: string[] }): Finding {
  const { history, ...rest } = f;
  return {
    kind: "finding",
    checks: {},
    issues: [],
    timeline: history.map((what, k) => ({ date: addDays(TODAY, -(history.length - k) * 2), who: what.startsWith("Action") ? "manager" : "mel", what })),
    ...rest,
  };
}

export function seedField(): FieldItem[] {
  return [
    farmer("F-0003", "Bibi Gul", 0.6, "train", { contributionPaid: false, enrolledOn: "2027-02-20" }, [], [3]),
    farmer("F-0004", "Hamid Karimi", 1.0, "train", { enrolledOn: "2027-02-18" }, ["attended"], [4]),
    farmer("F-0005", "Jawad Nazari", 0.5, "prepare", {}, ["plot"], [4, 3]),
    farmer("F-0009", "Mariam Sultani", 0.8, "verify", {}, ["joint", "form"], [4, 5]),
    farmer("F-0011", "Sayed Mansoor", 0.7, "verify", {}, [], [3, 4]),
    farmer("F-0012", "Laila Hashimi", 0.9, "correct", { deadline: "2027-03-09", correction: "Ridges not to spec; re-form at 75 cm spacing" }, ["explained"], [4, 3]),
    farmer("F-0014", "Noor Agha", 0.4, "removal", { deadline: "2027-03-01", correction: "Plot not cleared of stumps" }, [], [2, 2]),
    farmer("F-0007", "Shirin Ahmadi", 1.2, "distribute", {}, [], [5, 5]),
    farmer("F-0008", "Zainab Qaderi", 0.6, "distribute", {}, ["recipient"], [4, 4]),
    farmer("F-0002", "Rahmatullah Sharifi", 0.8, "plant", {}, [], [4, 5]),
    farmer(
      "F-0001",
      "Abdul Rahim",
      1.1,
      "complete",
      {
        stories: [
          {
            id: "S-1",
            status: "completed",
            title: "From one field to two",
            text: "After last season's demo plot, farmer F-0001 prepared a second field on his own and trained two neighbors in ridge spacing.",
            date: "2027-02-10",
            by: "mel",
          },
          { id: "S-2", status: "note", title: "Neighbor training", text: "Ask about the two neighbors at the next visit; possible follow-up story.", date: "2027-03-01", by: "extension" },
        ],
      },
      [],
      [4, 5, 5],
    ),
    finding({
      id: "MF-01",
      title: "Late land preparation on the river plots",
      summary: "Three plots near the river were prepared after the planned date, which risks late planting.",
      sources: ["F-0002", "F-0007", "F-0008"],
      step: "validate",
      ai: [
        "2 of 3 visit forms show land prepared after 20 Feb, later than the season plan.",
        "One form has no photo reference; the paper original is at the Village B office.",
        "All three forms note early rain onset. Check against the district rainfall record.",
      ],
      history: ["Finding drafted from field visits"],
    }),
    finding({
      id: "MF-02",
      title: "Readiness pass rate 85% on first visit",
      summary: "17 of 20 plots passed on the first visit. All three failures were ridge spacing.",
      sources: ["F-0012", "F-0014", "F-0009"],
      step: "decide",
      history: ["Finding drafted from field visits", "Validated and sent to management"],
    }),
    finding({
      id: "MF-03",
      title: "Ridge spacing errors in east Village B",
      summary: "Repeated spacing errors trace to one training group.",
      sources: ["F-0012", "F-0014"],
      step: "act",
      action: { text: "Run an extra ridge-forming demo for the east group", owner: "extension", due: "2027-03-12" },
      history: ["Finding drafted from field visits", "Validated and sent to management", "Action assigned to Extension agent"],
    }),
  ];
}
