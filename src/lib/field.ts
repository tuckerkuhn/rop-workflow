import type { HouseholdMember } from "@/lib/household";
/**
 * Field activities: roles, steps, checks, farmer profiles and synthetic records.
 * Steps follow docs/ROP-END-TO-END-WORKFLOW-DRAFT.md §2 (farm preparation to MEL follow-up).
 */

import type { DocLink } from "@/lib/doc-links";
import type { Issue, TimelineEvent } from "@/components/workspace/ui";
import { ORG_ID, PROJECT, TODAY, holderOf, projectPath, stepHistory, type AppUser, type FieldRole } from "@/lib/demo";
import { today } from "@/lib/clock";
import { msg } from "@/lib/i18n/text";
import { DEMO_SETUP, itemsFor, packageUsd, qtyUnit, type FieldSetup } from "@/lib/package";

export type { FieldRole };

export const fieldRoles: { id: FieldRole; label: string; short: string }[] = [
  { id: "extension", label: msg("Extension agent"), short: msg("Extension") },
  { id: "mel", label: msg("MEL officer"), short: msg("MEL") },
  { id: "store", label: msg("Distribution staff"), short: msg("Distribution") },
  { id: "manager", label: msg("Project manager"), short: msg("Management") },
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
export type Photo = {
  id: string;
  activity: PhotoKind;
  date: string;
  caption: string;
  src?: string;
  /** The photo is of the goods received note the recipient signed or thumbprinted (lib/distribution closeBlock). */
  signedNote?: boolean;
  /** The one tag picked when it was added (lib/kobo-photo PHOTO_TAGS): it decides where the photo is filed and what it sets going. */
  tag?: string;
  /** When the photo itself says it was taken (its EXIF data, read before it was shrunk). `date` above is that day when known. */
  taken?: { date: string; time: string | null };
  /** Where the photo itself says it was taken. Shown only to people who may see participant names. */
  gps?: { lat: number; lon: number };
  /** No longer set (decision AH, 25 Nov 2026): someone who may not see participant names is told nothing about a photo's place. A page loaded before then may send it back. Never stored. */
  hasPlace?: boolean;
  /** Who added it (person id and name), when it was added through the app. */
  by?: string;
  byName?: string;
  /** Added by someone visiting (management, communications): a picture of the work, never a field record or proof. */
  visitor?: boolean;
};
/**
 * Whether a save adds a photo of the signed goods received note that the stored record did not hold.
 * That photo is proof of a distribution, so only some people may add it (server/farmer-photo).
 */
export function addsSignedNote(stored: { photos?: Pick<Photo, "id">[] } | null | undefined, sent: { photos?: Pick<Photo, "id" | "signedNote" | "tag">[] } | null | undefined): boolean {
  const had = new Set((stored?.photos ?? []).map((p) => p.id));
  return (sent?.photos ?? []).some((p) => !had.has(p.id) && (!!p.signedNote || p.tag === "signed-note"));
}

/** Whether the farmer's record holds a photo of the signed goods received note. */
export const hasSignedNotePhoto = (f: { photos?: Photo[] } | null | undefined) => !!f?.photos?.some((p) => p.activity === "distribution" && p.signedNote && !!p.src);

/**
 * A stand-in photo of a signed goods received note for the demo farmers: a drawn form with the
 * farmer's ID, the package and a thumbprint. No names. Real records hold the photo Bilal takes.
 */
export function sampleNotePhoto(farmerId: string, date: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="340" viewBox="0 0 480 340">
<rect width="480" height="340" fill="#e9e4d8"/><rect x="24" y="16" width="432" height="308" fill="#fffdf6" stroke="#c9c2b0" transform="rotate(-1.2 240 170)"/>
<g font-family="Georgia, serif" fill="#2b2b2b" transform="rotate(-1.2 240 170)">
<text x="48" y="52" font-size="18" font-weight="bold">Roots of Peace · Goods received note</text>
<text x="48" y="80" font-size="13">Farmer ID: ${farmerId}    Date: ${date}</text>
<line x1="48" y1="94" x2="432" y2="94" stroke="#999"/>
<text x="48" y="120" font-size="13">Certified maize seed ........ 10 kg</text>
<text x="48" y="144" font-size="13">NPK 17-17-17 ................. 50 kg</text>
<text x="48" y="176" font-size="12" fill="#555">Received in good condition.</text>
<text x="48" y="262" font-size="12">Recipient (signature or thumbprint):</text>
<ellipse cx="330" cy="250" rx="22" ry="28" fill="#4a5a8a" opacity="0.55"/>
<text x="48" y="300" font-size="12">Storekeeper: ________ (signed)</text>
<text x="292" y="300" font-size="10" fill="#999">SAMPLE · demo data</text>
</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
export type PhotoKind = "training" | "landprep" | "visit" | "distribution" | "planting";

/** What the extension agent records at planting: the day the farmer planted and the area planted. */
export type Planting = {
  date: string;
  /** Hectares planted: typed for a crop sown by area, worked out from the count and spacing for one counted (lib/crops). */
  hectares: number;
  /** How many trees, vines or seedlings went in the ground, for a crop counted one by one. */
  count?: number;
};

/**
 * The day the farmer's input package was handed out: the date on the photo of the signed goods
 * received note, else the history line for it. Null when neither is on the record.
 */
export function handedOutOn(f: Pick<Farmer, "photos" | "timeline">): string | null {
  const note = [...(f.photos ?? [])].reverse().find((p) => p.activity === "distribution" && p.signedNote);
  if (note) return note.date;
  return [...(f.timeline ?? [])].reverse().find((t) => /^Inputs distributed|^Distribution.* approved by /.test(t.what))?.date ?? null;
}

/**
 * What is wrong with a farmer's planting record, in words the extension agent can act on; null
 * when it can be recorded. Planting cannot come before the package was handed out or after today,
 * and the area planted is at most the farmer's plot.
 */
export function plantingProblem(f: Pick<Farmer, "planting" | "hectares" | "photos" | "timeline">, today: string): string | null {
  const p = f.planting;
  if (!p) return "Record the day the farmer planted and the area planted.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || Number.isNaN(Date.parse(p.date))) return "The planting date must be a date.";
  if (p.date > today) return `The planting date ${p.date} is after today.`;
  const given = handedOutOn(f);
  if (given && p.date < given) return `Planted ${p.date}, before the inputs were handed out on ${given}. Check the date.`;
  if (p.count !== undefined && !(Number.isInteger(p.count) && p.count > 0)) return "Enter how many were planted, a whole number above zero.";
  if (!(p.hectares > 0)) return p.count !== undefined ? "The area worked out from the count is zero. Check the number planted." : "The area planted must be above zero.";
  if (p.hectares > f.hectares + 1e-9) return p.count !== undefined ? `${p.count.toLocaleString("en-US")} planted at this spacing takes ${p.hectares} ha, more than the farmer's plot (${f.hectares} ha). Check the number, or correct the plot size on the farmer's profile.` : `${p.hectares} ha planted is more than the farmer's plot (${f.hectares} ha). Check the area, or correct the plot size on the farmer's profile.`;
  return null;
}
/** A story note or completed story; `docs` are links to where its write-up, interview or consent scan lives. */
export type Story = { id: string; status: "note" | "completed"; title: string; text: string; date: string; by: string; docs?: DocLink[] };

export type Gender = "Female" | "Male";
/** Age bands. Young people are 35 and younger (owner's decision, 24 Nov 2026). */
export const AGE_BANDS = ["18–35 (youth)", "36–49", "50+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** Bands saved before 24 Nov 2026 (youth was 18 to 29), still read from older records. */
export type StoredAgeBand = AgeBand | "18–29 (youth)" | "30–49";
/** Whether a farmer in this band is young (35 or younger); null when the band cannot tell (the old 30 to 49). */
export function isYouth(band: string | null | undefined): boolean | null {
  if (!band) return null;
  if (band.startsWith("18")) return true;
  if (band.startsWith("36") || band.startsWith("50")) return false;
  return null;
}

export type Farmer = {
  kind: "farmer";
  orgId: string;
  id: string;
  /** Personal data. Shown only to people with participant-data access; AI agents never see it. */
  name: string;
  gender: Gender;
  ageBand: StoredAgeBand;
  householdSize: number;
  /** Who lives in the household, by sex and age (MF-07). The size above is its length when it is kept. */
  household?: HouseholdMember[];
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
  /** The planting record, entered at "Plant and follow up" and fixed once planting is recorded. */
  planting?: Planting;
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

export const farmerStages = [msg("Train"), msg("Prepare land"), msg("Readiness"), msg("Inputs"), msg("Plant"), msg("Season record")];
export const findingStages = [msg("Validate"), msg("Decide"), msg("Act"), msg("Next season")];

export const fieldSteps: Record<string, SStep> = {
  train: {
    id: "train",
    stage: 0,
    title: msg("Train for land preparation"),
    owner: "extension",
    checks: [
      {
        id: "enrolled",
        label: msg("Enrolled in the program"),
        why: msg("Farmers must have enrolled officially before program training."),
        tag: "TS",
        auto: (i) => ({ ok: asFarmer(i).enrolled, detail: asFarmer(i).enrolled ? `Enrollment recorded ${asFarmer(i).enrolledOn}` : "No enrollment record" }),
      },
      {
        id: "contribution",
        label: msg("Agreed contribution paid"),
        why: msg("The farmer contribution is collected after selection and before program entry or training."),
        tag: "TS",
        auto: (i) => ({ ok: asFarmer(i).contributionPaid, detail: asFarmer(i).contributionPaid ? "Contribution received" : "Not yet received" }),
        resolve: msg("Record contribution received"),
        resolveDone: "Contribution received",
        resolveEffect: (i) => ({ ...asFarmer(i), contributionPaid: true }),
      },
      { id: "attended", label: msg("Attended classroom and field training"), why: msg("Crop-stage training: here, land preparation and planting."), tag: "TS" },
      { id: "register", label: msg("Attendance register reference recorded"), why: msg("Paper counts as source evidence. Record who completed it, when, and where the original is kept."), tag: "TS" },
    ],
    outcomes: [{ label: msg("Record training"), to: "prepare", done: "Training recorded", tone: "primary" }],
  },
  prepare: {
    id: "prepare",
    stage: 1,
    title: msg("Prepare the plot"),
    owner: "extension",
    checks: [
      { id: "plot", label: msg("Plot agreed and located (GPS or sketch)"), why: msg("The plot is linked to farmer, crop, season and project."), tag: "TS" },
      { id: "spec", label: msg("Farmer reports land prepared to the technical spec"), why: msg("Clearing, ridges and spacing as trained. The joint visit confirms it."), tag: "TS" },
    ],
    outcomes: [{ label: msg("Request readiness visit"), to: "verify", done: "Readiness visit requested", tone: "primary" }],
  },
  verify: {
    id: "verify",
    stage: 2,
    title: msg("Verify readiness"),
    owner: "mel",
    note: () => msg("Joint site visit. Inputs move only on Yes."),
    checks: [
      { id: "joint", label: msg("Extension agent and MEL both at the plot"), why: msg("Readiness is verified jointly so the technical and evidence views agree."), tag: "TS" },
      { id: "form", label: msg("Standard field-visit form completed"), why: msg("The same form for every plot keeps findings comparable."), tag: "TS" },
      { id: "photo", label: msg("Photo or paper form reference attached"), why: msg("Evidence reference for the yes/no finding."), tag: "TS" },
    ],
    outcomes: [
      { label: msg("Ready: Yes"), to: "distribute", done: "Readiness: Yes", tone: "primary" },
      {
        label: msg("Not ready: No"),
        to: "correct",
        done: "Readiness: No",
        tone: "danger",
        note: msg("What needs fixing?"),
        effect: (i, note, ctx) => ({ item: { ...asFarmer(i), deadline: addDays(ctx.today, 7), correction: note } }),
      },
    ],
  },
  correct: {
    id: "correct",
    stage: 2,
    title: msg("Correct and recheck"),
    owner: "extension",
    note: (i) => (asFarmer(i).correction ? `To fix: ${asFarmer(i).correction}` : undefined),
    checks: [
      { id: "explained", label: msg("Corrective action explained to the farmer"), why: msg("The farmer gets a defined opportunity and deadline to fix the issue."), tag: "TS" },
      {
        id: "deadline",
        label: msg("Recheck is within the deadline"),
        why: msg("If the issue is unresolved by the deadline, the farmer is removed. Expected to be rare after contribution."),
        tag: "TS",
        auto: (i, ctx) => {
          const d = asFarmer(i).deadline;
          if (!d) return null;
          const left = daysBetween(ctx.today, d);
          return { ok: left >= 0, detail: left >= 0 ? `Deadline ${d} · ${left} days left` : `Deadline ${d} passed ${-left} days ago` };
        },
      },
      { id: "recheck", label: msg("Recheck visit done and form completed"), why: msg("Same standard form as the first visit."), tag: "TS" },
    ],
    outcomes: [
      { label: msg("Recheck: Yes"), to: "distribute", done: "Recheck: Yes", tone: "primary" },
      { label: msg("Still not ready"), to: "removal", done: "Recheck: No, sent for decision", tone: "danger", note: msg("What is still wrong?"), requiresChecks: false },
    ],
  },
  removal: {
    id: "removal",
    stage: 2,
    title: msg("Decide: remove or extend"),
    owner: "manager",
    note: (i) => `Correction: ${asFarmer(i).correction ?? "not recorded"}. Removal follows local rules.`,
    checks: [
      { id: "history", label: msg("Correction history reviewed"), why: msg("Issue, deadline, recheck result and decisions are on the record below."), tag: "TS" },
      { id: "rules", label: msg("Local rules on removal followed"), why: msg("Project authority confirms removal per local rules."), tag: "TS; OPEN roles" },
    ],
    outcomes: [
      { label: msg("Confirm removal"), to: "removed", done: "Removed from the project", tone: "danger", note: msg("Reason for the record") },
      {
        label: msg("Extend 7 days"),
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
    title: msg("Distribute the input package"),
    owner: "store",
    checks: [
      {
        id: "stock",
        label: msg("Package in stock at the store"),
        why: msg("Inputs come from procurement, on the package's budget lines. Stock falls as packages go out."),
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
        fix: msg("Store is short for this package: check the procurement status."),
      },
      { id: "recipient", label: msg("Recipient signed the goods received note"), why: msg("By signature or thumbprint the recipient says they received the goods in acceptable condition and are responsible for them from then on."), tag: "TS" },
      { id: "voucher", label: msg("Store issue voucher number recorded"), why: msg("Links the distribution to expenditure evidence on the package's budget lines."), tag: "TS" },
    ],
    outcomes: [
      {
        label: msg("Record distribution"),
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
    title: msg("Plant and follow up"),
    owner: "extension",
    checks: [
      {
        id: "recorded",
        label: msg("Planting date and area recorded"),
        why: msg("The day and the area are the evidence that the inputs went into the ground, for MEL and the donor report."),
        tag: "TS",
        auto: (i, ctx) => {
          const f = asFarmer(i);
          const problem = plantingProblem(f, ctx.today);
          const p = f.planting!;
          return problem ? { ok: false, detail: problem } : { ok: true, detail: `Planted ${p.date} · ${p.count !== undefined ? `${p.count.toLocaleString("en-US")} ${ctx.setup.plan?.unit ?? "plants"}, ` : ""}${p.hectares} of ${f.hectares} ha` };
        },
      },
      {
        id: "window",
        label: msg("Planted within the planting window"),
        why: msg("The targeted crop at the right time."),
        tag: "TS",
        auto: (i, ctx) => {
          const end = ctx.setup.windowEnd;
          if (!end) return null;
          const p = asFarmer(i).planting;
          // Judged on the day the farmer planted, not on today.
          if (p) return { ok: p.date <= end, detail: p.date <= end ? `Planted ${p.date}, window closes ${end}` : `Planted ${p.date}, after the window closed ${end}` };
          const left = daysBetween(ctx.today, end);
          return { ok: false, detail: left >= 0 ? `Window closes ${end} · ${left} days left · record the planting date` : `Window closed ${end} · record the planting date` };
        },
      },
      { id: "manner", label: msg("Planted at the right spacing and depth"), why: msg("The right manner, as trained."), tag: "TS" },
      { id: "followup", label: msg("Follow-up visit form completed with MEL"), why: msg("Technical and MEL teams complete the standard follow-up form."), tag: "TS" },
    ],
    outcomes: [{ label: msg("Record planting"), to: "complete", done: "Planting recorded", tone: "primary" }],
  },
  validate: {
    id: "validate",
    stage: 0,
    title: msg("Validate the finding"),
    owner: "mel",
    checks: [
      {
        id: "sources",
        label: msg("Linked to source records"),
        why: msg("Every finding traces back to the field records it came from."),
        tag: "TS",
        auto: (i) => {
          const s = (i as Finding).sources;
          return { ok: s.length > 0, detail: s.length ? `${s.length} farmer records: ${s.join(", ")}` : "No source records linked" };
        },
      },
      { id: "aiSummary", label: msg("AI summary checked against the source forms"), why: msg("AI may organize records and draft analysis. MEL validates evidence and interpretation."), tag: "TS", ai: true },
      { id: "interpretation", label: msg("Interpretation agreed within MEL"), why: msg("MEL prepares and validates the analysis before management sees it."), tag: "TS" },
    ],
    outcomes: [{ label: msg("Send to management"), to: "decide", done: "Validated and sent to management", tone: "primary" }],
  },
  decide: {
    id: "decide",
    stage: 1,
    title: msg("Decide what to do"),
    owner: "manager",
    checks: [{ id: "read", label: msg("Evidence summary reviewed"), why: msg("Management reviews validated findings, then sets adjustments, owners and deadlines."), tag: "TS" }],
    outcomes: [{ label: msg("No action needed"), to: "closed", done: "Closed: no action needed", tone: "quiet", note: msg("Why no action?") }],
  },
  act: {
    id: "act",
    stage: 2,
    title: msg("Carry out the action"),
    owner: "action-owner",
    note: (i) => {
      const a = (i as Finding).action;
      return a ? `${a.text} · due ${a.due}` : undefined;
    },
    checks: [
      { id: "doneIt", label: msg("Action carried out"), why: msg("The owner reports back against the due date."), tag: "TS" },
      { id: "evidence", label: msg("Evidence recorded"), why: msg("So the learning can carry into the next seasonal plan."), tag: "TS" },
    ],
    outcomes: [{ label: msg("Mark done"), to: "closed", done: "Action done: feeds the next season plan", tone: "primary" }],
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

/** What Field activities says when a field step is entered by hand: KoboCollect is the one source of truth. */
export const KOBO_ONLY = msg("Field visits are recorded in KoboCollect; this page shows them.");

/**
 * Why a farmer's record may not be changed from the app, or null. Field steps (training, the
 * readiness visit, distribution, planting) are recorded in KoboCollect and move the farmer once MEL
 * accepts the form, or the project manager approves the distribution. The app does not tick a
 * step's checks, move the step, or enter the planting record by hand. Kept: the project manager's
 * decision to remove a farmer or extend the deadline (a decision, not a visit), and notes on the
 * record that are not field steps (issues, surveys, photos, stories, the contribution received).
 */
export function handRecordProblem(stored: FieldItem | undefined, sent: FieldItem): string | null {
  if (sent.kind !== "farmer" || stored?.kind !== "farmer") return null;
  const decision = stored.step === "removal";
  const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  if (stored.step !== sent.step && !decision) return KOBO_ONLY;
  const keys = new Set([...Object.keys(stored.checks), ...Object.keys(sent.checks)]);
  if ([...keys].some((k) => !!stored.checks[k] !== !!sent.checks[k] && !(decision && k.startsWith("removal.")))) return KOBO_ONLY;
  if (changed(stored.planting, sent.planting)) return KOBO_ONLY;
  if (!decision && (changed(stored.deadline, sent.deadline) || changed(stored.correction, sent.correction))) return KOBO_ONLY;
  return null;
}

/**
 * What still keeps a farmer whose training is recorded at Train, or null when they may move on to
 * Prepare the plot: enrolled, contribution paid, and (`hold`, lib/selection selectionHold) not
 * waitlisted or left out in Farmer selection.
 */
export function trainBlock(f: Farmer, hold: string | null = null): string | null {
  if (!f.enrolled) return "not enrolled";
  if (!f.contributionPaid) return "contribution not yet paid";
  return hold;
}

const trained = (f: Farmer) => !!f.checks["train.attended"] && !!f.checks["train.register"];

/**
 * The move on from Train, one rule wherever its inputs change: training attendance accepted from
 * KoboCollect (server/review applyTraining), enrolment or the contribution recorded in the app (no
 * KoboCollect form asks them), or the farmer selected in Farmer selection. A farmer at Train whose
 * training is recorded moves on to Prepare the plot once nothing in trainBlock holds them;
 * otherwise `f` comes back unchanged, with a line saying why when only selection holds them.
 * `cause`: what just changed, for the farmer's history.
 */
export function leaveTrain(f: Farmer, date: string, cause: string, hold: string | null = null): Farmer {
  if (f.step !== "train" || !trained(f)) return f;
  const block = trainBlock(f, hold);
  if (block === hold && hold) return { ...f, timeline: [...f.timeline, { date, who: "system", what: `${cause}; training already recorded, but stays at Train: ${hold}` }] };
  if (block) return f;
  return { ...f, step: "prepare", timeline: [...f.timeline, { date, who: "system", what: `${cause}; training already recorded from KoboCollect: moved to Prepare the plot` }] };
}

/**
 * A farmer saved from the app (Field activities): when enrolment, the contribution or the training
 * checks changed on a farmer at Train, the Train rule (leaveTrain) is evaluated again, so a farmer
 * whose training KoboCollect recorded while not enrolled or unpaid is not left stuck at Train (a
 * hand move is refused). Otherwise `sent` unchanged.
 */
export function afterTrainInputs(stored: FieldItem | undefined, sent: FieldItem, date: string, hold: string | null = null): FieldItem {
  if (sent.kind !== "farmer" || stored?.kind !== "farmer") return sent;
  if (stored.step !== "train" || sent.step !== "train") return sent;
  const was = stored as Farmer;
  const now = sent as Farmer;
  if (was.enrolled === now.enrolled && was.contributionPaid === now.contributionPaid && trained(was) === trained(now)) return sent;
  const cause = [!was.enrolled && now.enrolled && "Enrolment recorded", !was.contributionPaid && now.contributionPaid && "Contribution received"].filter(Boolean).join(" and ") || "Training record changed";
  return leaveTrain(now, date, cause, hold);
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

export const issueTypes = [msg("Field issue"), msg("Evidence gap"), msg("Needs a decision")];
export const issueHelp: Record<string, string> = {
  "Field issue": msg("Something on the plot or with the farmer that is holding this step."),
  "Evidence gap": msg("A form, photo or paper record is missing or does not match."),
  "Needs a decision": msg("Someone with authority has to decide before this can move."),
};
export const ISSUE_FOOTNOTE = msg("A farmer complaint or a safeguarding concern? Do not record it here. Use the project's grievance mechanism.");

export const photoLabels: Record<PhotoKind, string> = {
  training: msg("Training"),
  landprep: msg("Land preparation"),
  visit: msg("Readiness visit"),
  distribution: msg("Input distribution"),
  planting: msg("Planting"),
};

/* ---------- participant privacy ---------- */

/** Farmer IDs everywhere; the name only for people with participant-data access. */
export const farmerLabel = (f: { id: string; name: string }, u: AppUser | null | undefined) => (u?.pii && f.name ? `${f.name} · ${f.id}` : `Farmer ${f.id}`);
export const farmerName = (f: { id: string; name: string }, u: AppUser | null | undefined) => (u?.pii && f.name ? f.name : `Farmer ${f.id}`);
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const patterns = new Map<string, RegExp | null>();

/**
 * Where a farmer's name appears in text: the full name and each part of it (three letters or more,
 * as in lib/doc-links docNamesPerson), in any capitals, as whole words only, so "Ali" matches but
 * "Alison" does not. Group 1 is the character before the name, group 2 the name as written. Built
 * once per name, and without lookbehind, which older iPads and phones cannot run.
 */
export function namePattern(name: string): RegExp | null {
  const full = name.trim();
  if (!patterns.has(full)) {
    const parts = full ? [full, ...full.split(/\s+/).filter((w) => w.length >= 3)].sort((a, b) => b.length - a.length) : [];
    const word = "\\p{L}\\p{N}\\p{M}";
    patterns.set(full, parts.length ? new RegExp(`(^|[^${word}])(${parts.map((p) => escaped(p).replace(/\s+/g, "\\s+")).join("|")})(?=[^${word}]|$)`, "giu") : null);
  }
  return patterns.get(full)!;
}

/** Replaces a farmer's name in free text with their number (namePattern). The same rule on the screen and the server. */
export function hideName(text: string, name: string, id: string): string {
  const re = namePattern(name);
  return re ? text.replace(re, (_, before: string) => `${before}Farmer ${id}`) : text;
}

/** Replaces a farmer's name in free text (e.g. a story) for people without access. */
export const maskName = (text: string, f: { id: string; name: string }, u: AppUser | null | undefined) => (u?.pii || !f.name ? text : hideName(text, f.name, f.id));

/* ---------- synthetic records ---------- */

const DEMOGRAPHICS: Record<string, [Gender, AgeBand, number]> = {
  "F-0001": ["Male", "50+", 9],
  "F-0002": ["Male", "36–49", 7],
  "F-0003": ["Female", "36–49", 6],
  "F-0004": ["Male", "18–35 (youth)", 4],
  "F-0005": ["Male", "18–35 (youth)", 5],
  "F-0007": ["Female", "36–49", 8],
  "F-0008": ["Female", "18–35 (youth)", 5],
  "F-0009": ["Female", "36–49", 7],
  "F-0011": ["Male", "50+", 10],
  "F-0012": ["Female", "50+", 6],
  "F-0014": ["Male", "36–49", 7],
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
  const extraPlanting: Partial<Farmer> = {};
  farmerPath.slice(0, reached).forEach((s, k) => {
    fieldSteps[s].checks.forEach((c) => (checks[`${s}.${c.id}`] = true));
    const outcome = s === "verify" && (step === "correct" || step === "removal") ? "Readiness: No" : fieldSteps[s].outcomes[0].done;
    const date = addDays(TODAY, -(reached - k) * 5);
    timeline.push({ date, who: owners[s], what: outcome });
    if (s === "plant") extraPlanting.planting = { date, hectares };
    if (s === "distribute") photos.push({ id: `${id}-note`, activity: "distribution", date, caption: `Signed goods received note · ${id}`, src: sampleNotePhoto(id, date), signedNote: true });
    else if (s !== "verify" || k % 2 === 0) photos.push({ id: `${id}-${s}`, activity: photoFor[s], date, caption: `${fieldSteps[s].title} · ${id}` });
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
  const demo = DEMOGRAPHICS[id] ?? ["Male", "36–49", 6];
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
    ...extraPlanting,
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
            title: msg("From one field to two"),
            text: "After last season's demo plot, farmer F-0001 prepared a second field on his own and trained two neighbors in ridge spacing.",
            date: "2027-02-10",
            by: "mel",
          },
          { id: "S-2", status: "note", title: msg("Neighbor training"), text: "Ask about the two neighbors at the next visit; possible follow-up story.", date: "2027-03-01", by: "extension" },
        ],
      },
      [],
      [4, 5, 5],
    ),
    finding({
      id: "MF-01",
      title: msg("Late land preparation on the river plots"),
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
      title: msg("Readiness pass rate 85% on first visit"),
      summary: "17 of 20 plots passed on the first visit. All three failures were ridge spacing.",
      sources: ["F-0012", "F-0014", "F-0009"],
      step: "decide",
      history: ["Finding drafted from field visits", "Validated and sent to management"],
    }),
    finding({
      id: "MF-03",
      title: msg("Ridge spacing errors in east Village B"),
      summary: "Repeated spacing errors trace to one training group.",
      sources: ["F-0012", "F-0014"],
      step: "act",
      action: { text: "Run an extra ridge-forming demo for the east group", owner: "extension", due: "2027-03-12" },
      history: ["Finding drafted from field visits", "Validated and sent to management", "Action assigned to Extension agent"],
    }),
  ];
}
