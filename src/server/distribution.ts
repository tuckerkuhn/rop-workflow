import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { stampHistory } from "@/lib/history";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { today } from "@/lib/clock";
import type { AppUser } from "@/lib/demo";
import { approverNames, collectorOf, deciderNames, decidersOf, needsKoboCheck, refusalFor } from "@/lib/kobo-approval";
import { koboApprovalFor } from "@/server/kobo-approval";
import { selectionHold } from "@/lib/selection";
import { selectionOutcomes } from "@/server/selection-store";
import { insertResult } from "@/server/results-store";
import { addGiven, applyFix, approvalRefusal, approverNamesOf, badCondition, approversOf, closeBlock, drawnFrom, fixOwner, flagsFor, gate, inProcUnit, lineOf, paymentDue, resultFor, resultForPlanting, storeStock, type DistItem, type Fix, type Flag, type Gate, type Given } from "@/lib/distribution";
import { countsAtPlanting, itemsFor, qtyItem, type FieldSetup } from "@/lib/package";
import { hasSignedNotePhoto, type Farmer } from "@/lib/field";
import type { Procurement } from "@/lib/procurement";
import type { Submission } from "@/lib/project";
import { demoMode, onProject, people, toAppUser } from "@/server/auth";
import { projectByCode, setupOf } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { loadProjectState, type Reader } from "@/server/project-state";
import { oncePerRequest, requestWrote } from "@/server/request-memo";

/**
 * One input distribution, field to finance (strategy brief, example 3):
 *
 * 1. Recorded: in Field activities ("Record distribution") or from the Kobo distribution form.
 *    In the app it is refused until each item's goods received note is signed and the quantity
 *    is within what was received; from Kobo it cannot be approved until then.
 * 2. Checked and flagged: same farmer twice, above plan, no photo of the signed list, unsigned.
 * 3. The project manager is emailed at once with a single-use approval link (and sees it on Home).
 * 4. Approved: the record counts toward the distribution target by sex (MEL and the donor report),
 *    the purchase's distribution list grows (procurement), finance is told the goods are in and out
 *    (ready to pay), and everything is in the audit log. Sent back: the person who recorded it gets
 *    a task to fix it, corrects the record on the same screen and sends it again (5).
 * 5. Fixed and sent again: the record is pending once more with fresh checks, the manager is told,
 *    and the fix task closes. Nothing counted while it was sent back.
 *
 * Each distribution is an `evidence` row (form "distribution"). What the app works out about it
 * (items, checks, flags, the approval link's hash) is kept in project_state "distributions".
 * Never carries a farmer's name: IDs and villages only.
 */

const KEY = "distributions";
const LINK_DAYS = 14;

export type DistMeta = {
  farmerId: string;
  items: DistItem[];
  gender: "Female" | "Male" | null;
  village: string;
  recordedBy: string;
  gate: Gate;
  flags: Flag[];
  /** Older records: sha256 of the one link every manager shared. Cleared once used. */
  hash: string | null;
  /**
   * sha256 of each manager's own link, by person id, so a decision from an emailed link is recorded
   * under the manager who used it. All are cleared once the distribution is decided.
   */
  hashes?: Record<string, string>;
  expires: string;
  /** Whether the signed list was photographed and the recipient's signature confirmed, once a fix has said so. */
  photo?: boolean;
  signed?: boolean;
  /** A fix has said the recipient accepted what was finally handed over in acceptable condition. */
  conditionOk?: boolean;
  /** Person id of who recorded it, when that is a person in the app (not a Kobo username). */
  recorderId?: string | null;
  notified?: { to: string[]; at: string; emailed: boolean; why?: string };
  /** A record from KoboCollect: who checked it before the project manager could approve it (lib/kobo-approval). */
  koboChecked?: { by: string; byName: string; at: string };
  decided?: { by: string; byName: string; at: string; decision: "approved" | "sent_back"; note?: string };
  /** Earlier rounds: each send-back with what was fixed in answer, oldest first. */
  history?: { sentBack: NonNullable<DistMeta["decided"]>; fixed: { by: string; byName: string; at: string; note: string } }[];
};
type State = { byId: Record<string, DistMeta> };

const loadState = async (projectId: string, q?: Reader) => loadProjectState<State>(projectId, KEY, { byId: {} }, q);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Stores one distribution's checks without touching the others: the database merges this one entry
 * into the document in a single statement, so two people recording or deciding at the same moment
 * cannot overwrite each other's (the whole document was read, changed and written back before).
 */
async function putMeta(q: Tx | typeof db, projectId: string, id: string, meta: DistMeta) {
  const doc = JSON.stringify({ byId: { [id]: meta } });
  await q.execute(sql`
    insert into ${s.projectState} (project_id, key, data) values (${projectId}::uuid, ${KEY}, ${doc}::jsonb)
    on conflict (project_id, key) do update
      set data = jsonb_set(coalesce(${s.projectState}.data, '{}'::jsonb), '{byId}', coalesce(${s.projectState}.data -> 'byId', '{}'::jsonb) || (excluded.data -> 'byId')),
          updated_at = now()`);
}
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

type Project = Awaited<ReturnType<typeof projectByCode>>;

/** May correct a sent-back distribution and send it again: anyone who can change field records on the project. */
export const mayFix = (u: AppUser, code: string) => u.kind === "employee" && u.fieldAccess === "edit" && onProject(u, code);

/** A project's package; a project without one has nothing to hand out. */
const setupOrEmpty = async (project: Project, q?: Reader): Promise<FieldSetup> => (await setupOf(project, q)) ?? { items: [] };

/**
 * Reads that the distribution list, the store's stock and Home each need: once per read-only
 * request (server/request-memo). Inside a transaction, and in any request that writes, they are
 * read afresh every time.
 */
const procurementRows = (projectId: string, q: Reader = db) => {
  // An async function, so the query runs once: a query builder runs again each time it is awaited.
  const read = async () => q.select().from(s.procurements).where(eq(s.procurements.projectId, projectId));
  return q === db ? oncePerRequest(`procurements:${projectId}`, read) : read();
};
const distributionRows = (projectId: string, q: Reader = db) => {
  const read = async () => q.select().from(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.form, "distribution")));
  return q === db ? oncePerRequest(`distribution-rows:${projectId}`, read) : read();
};
/** Every field record of the project (its key and data), as the list and Home read them. */
export const fieldItemRows = (projectId: string) =>
  oncePerRequest(`field-items:${projectId}`, async () => db.select({ key: s.fieldItems.itemKey, data: s.fieldItems.data }).from(s.fieldItems).where(eq(s.fieldItems.projectId, projectId)));

/**
 * Stock decisions on a project happen one at a time: the lock is held until the transaction ends,
 * so a second distribution recorded or approved at the same moment waits, then checks the stock
 * against the first one's outcome instead of the same remaining stock.
 */
const lockStock = (tx: Tx, projectId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rop-stock:${projectId}`}))`);

/**
 * Everything the gate needs: the package, the purchases, and what each earlier distribution took.
 * `q`: read inside an open transaction (under the stock lock) instead of the database.
 */
async function context(project: Project, opts: { excluding?: string; countPending: boolean }, q: Reader = db) {
  const reads = [
    () => setupOrEmpty(project, q),
    () => procurementRows(project.id, q),
    () => distributionRows(project.id, q),
    () => loadState(project.id, q),
  ] as const;
  // On the pool the four reads go at once; inside a transaction (one connection) one after another.
  const [setup, procRows, rows, st] =
    q === db ? await Promise.all([reads[0](), reads[1](), reads[2](), reads[3]()]) : [await reads[0](), await reads[1](), await reads[2](), await reads[3]()] as const;
  const procs = procRows.map((r) => r.data as Procurement);
  const given: Given = {};
  for (const r of rows) {
    if (r.id === opts.excluding || r.koboRemovedAt || r.reviewStatus === "queried") continue;
    if (r.reviewStatus === "pending" && !opts.countPending) continue;
    // A record with no items stored (made before quantities were kept) is one planned package.
    addGiven(given, st.byId[r.id]?.items ?? itemsFor(setup), setup);
  }
  return { setup, procs, given, others: othersThan(rows, opts.excluding), st, rows };
}

/** The farmers of every other distribution that still stands (not removed, not sent back), for the "same farmer twice" check. */
const othersThan = (rows: { id: string; farmerCode: string | null; koboRemovedAt: Date | null; reviewStatus: string }[], excluding?: string) =>
  rows.filter((r) => r.id !== excluding && !r.koboRemovedAt && r.reviewStatus !== "queried" && r.farmerCode).map((r) => r.farmerCode!);

/**
 * What is in the store, for Field activities: received on signed goods received notes, less every
 * distribution recorded and not sent back. Null when no purchase supplies the package.
 */
export async function stockFor(code: string) {
  const project = await projectByCode(code);
  const ctx = await context(project, { countPending: true });
  const stock = storeStock(ctx.setup, ctx.procs, ctx.given);
  // Why the next package cannot go out, in the gate's own words, so the screen says what unblocks it.
  return stock ? { stock, block: gate(itemsFor(ctx.setup), ctx.procs, ctx.given, ctx.setup).block } : null;
}

/** Changes a farmer's Field activities record inside a transaction; `change` returns null to leave it. */
async function changeFarmer(tx: Tx, projectId: string, farmerCode: string, change: (f: Farmer) => Farmer | null) {
  const [item] = await tx.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, projectId), eq(s.fieldItems.itemKey, farmerCode))).limit(1);
  if (!item) return;
  const changed = change(item.data as Farmer);
  if (!changed) return;
  // New history lines get the time they were saved (lib/history).
  const next = { ...changed, timeline: stampHistory((item.data as Farmer).timeline, changed.timeline ?? []) };
  await tx.update(s.fieldItems).set({ data: next, updatedAt: new Date() }).where(eq(s.fieldItems.id, item.id));
  await mirrorFarmer(tx, projectId, next);
}

async function farmerOf(projectId: string, code: string) {
  return (await farmersOf(projectId, [code])).get(code) ?? null;
}

/** Farmer records by farmer ID, many at once: results from KoboToolbox read each farmer's sex from them (server/kobo-results). */
export async function farmersOf(projectId: string, codes: string[]): Promise<Map<string, Farmer>> {
  const out = new Map<string, Farmer>();
  const ids = [...new Set(codes.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db.select({ key: s.fieldItems.itemKey, data: s.fieldItems.data }).from(s.fieldItems).where(and(eq(s.fieldItems.projectId, projectId), inArray(s.fieldItems.itemKey, ids.slice(i, i + 500))));
    for (const r of rows) out.set(r.key, r.data as Farmer);
  }
  return out;
}

/**
 * The photo of the signed goods received note on the farmer's record, newest first, so whoever
 * approves can see the proof and not only that it exists. Null when there is none in the app
 * (a KoboCollect photo stays in KoboToolbox). Read for one distribution only: photos are large.
 */
export async function signedNotePhoto(code: string, farmerCode: string): Promise<{ src: string; date: string } | null> {
  const project = await projectByCode(code);
  const f = await farmerOf(project.id, farmerCode);
  const p = [...(f?.photos ?? [])].reverse().find((x) => x.activity === "distribution" && x.signedNote && x.src);
  return p?.src ? { src: p.src, date: p.date } : null;
}

/**
 * Who a distribution goes to for approval, with their email: the project's managers, never the
 * person who recorded or collected it; with no other manager, the person they report to
 * (lib/distribution approversOf).
 */
async function approversFor(code: string, recorder: string | null) {
  const team = (await people()).filter((u) => onProject(u, code));
  const rows = await db.select().from(s.staff).where(eq(s.staff.active, true));
  const email = new Map(rows.filter((r) => r.personId && r.profile && r.email).map((r) => [toAppUser(r).id, r.email!]));
  const test = demoMode() ? process.env.NOTIFY_TEST_TO?.trim() || null : null;
  return { team, list: approversOf(team, recorder).map((u) => ({ user: u, email: test ?? email.get(u.id) ?? null })) };
}

/** The person who recorded a distribution in the app, or collected it in KoboCollect when their account is matched; null when unknown. */
const recorderOf = (row: { source: string; completedBy: string | null }, m: Pick<DistMeta, "recorderId"> | undefined, rule: Parameters<typeof collectorOf>[1], team: Parameters<typeof collectorOf>[2]) =>
  row.source === "kobo" ? collectorOf(row.completedBy, rule, team) : (m?.recorderId ?? row.completedBy ?? null);

const qtyOf = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/* ---------- 1. recorded in the app ---------- */

/**
 * Called when a farmer moves from "distribute" to "plant" in Field activities. Refuses (409) when
 * the package may not go out yet; otherwise stores the distribution and tells the project manager.
 */
export async function recordFromApp(code: string, farmer: Farmer, user: AppUser, origin: string) {
  const project = await projectByCode(code);
  // The stock check and the stored record are one step under the project's stock lock (lockStock).
  const made = await db.transaction(async (tx) => {
    await lockStock(tx, project.id);
    const ctx = await context(project, { countPending: true }, tx);
    if (!ctx.setup.items.length) throw new HttpError(409, `${code} has no input package set up yet. The project manager sets it up in Field activities.`);
    const items = itemsFor(ctx.setup, farmer.hectares);
    const g = gate(items, ctx.procs, ctx.given, ctx.setup);
    if (!g.ok) throw new HttpError(409, `${farmer.id}'s input package can't be recorded as handed out yet. ${g.block}`);
    // Saved twice (a retry, a double tap, a lost connection): the distribution already waiting for
    // this farmer is this one. Nothing new is stored and the manager is not emailed again.
    const waiting = ctx.rows.find((r) => r.farmerCode === farmer.id && r.reviewStatus === "pending" && !r.koboRemovedAt && r.source === "manual" && (r.payload as { source?: string } | null)?.source === "app");
    if (waiting) return { id: waiting.id, next: null };
    const signed = !!farmer.checks["distribute.recipient"];
    const photo = hasSignedNotePhoto(farmer);
    const sub: Submission = {
      id: `DS-${farmer.id}-${today()}`,
      source: "app",
      orgId: farmer.orgId,
      form: "distribution",
      farmerId: farmer.id,
      date: today(),
      enumerator: user.id,
      gps: null,
      fields: { gender: farmer.gender, ...Object.fromEntries(items.map((i) => [`${i.key}_${i.unit}`, String(i.qty)])), signature: signed ? "Yes" : "Not confirmed" },
      photo,
      status: "pending",
    };
    const [row] = await tx
      .insert(s.evidence)
      .values({ organizationId: project.organizationId, projectId: project.id, source: "manual", form: "distribution", farmerCode: farmer.id, reviewStatus: "pending", completedBy: user.id, completedAt: new Date(), location: farmer.community, payload: sub })
      .returning({ id: s.evidence.id });
    const flags = flagsFor({ farmerId: farmer.id, items, photo, signed, step: null }, ctx.others, items);
    return { id: row.id, next: { items, photo, signed, g, flags } };
  });
  // Checks stored and the manager emailed once the record is saved, outside the lock.
  if (made.next) {
    const { items, photo, signed, g, flags } = made.next;
    await prepare(code, project, made.id, { farmerId: farmer.id, items, gender: farmer.gender, village: farmer.community, recordedBy: user.name, recorderId: user.id, photo, signed, gate: g, flags }, origin);
  }
  return made.id;
}

/* ---------- 1b. from the Kobo distribution form, or anything not yet checked ---------- */

/** The app's address for links in emails sent outside a request (cron, webhook, Home). */
export const appOrigin = () =>
  process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

/**
 * Every waiting distribution without checks yet (new from Kobo, or stored before this flow existed)
 * gets its checks, flags and the email to the manager. Runs after a Kobo sync and when listed.
 */
export async function processPending(code: string, origin = appOrigin()) {
  const project = await projectByCode(code);
  const [rows, st] = await Promise.all([
    db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"), eq(s.evidence.reviewStatus, "pending"))),
    loadState(project.id),
  ]);
  // Most of the time every pending record already has its checks (Home lists them on every load):
  // then nothing more is read.
  const todo = rows.filter((r) => !st.byId[r.id] && !r.koboRemovedAt);
  if (!todo.length) return 0;
  // The gate's context is read once for all of them. It does not change as they are processed: the
  // purchases and package are untouched, and only approved records count as given (these are
  // pending, so neither excluding one nor storing another's checks moves it). The "same farmer
  // twice" list leaves out the record being checked, as before.
  const ctx = await context(project, { countPending: false });
  let done = 0;
  // Reads kept for this request (server/request-memo) may be from before these writes, so they
  // are dropped once anything is written, also when a later record fails.
  try {
  for (const r of todo) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    // Kobo answers sit at the top of the submission; a record made in the app keeps them in `fields`.
    const f = (typeof p.fields === "object" && p.fields ? p.fields : p) as Record<string, unknown>;
    const code_ = r.farmerCode ?? String(p.farmer ?? p.farmerId ?? "");
    const [farmer, recordedBy] = await Promise.all([code_ ? farmerOf(project.id, code_) : null, recorderName(r.completedBy)]);
    // The Kobo form answers "<item>_qty" in the package unit ("seed_kg" on the demo form).
    const planned = itemsFor(ctx.setup, farmer?.hectares);
    // A partial package: an item answered "not given" is left out (nothing counted, checked or charged).
    const items = planned
      .filter((i) => f[`${i.key}_given`] !== "no")
      .map((i) => ({ ...i, qty: qtyOf(f[`${i.key}_qty`]) ?? qtyOf(f[`${i.key}_${i.unit}`]) ?? qtyOf(f[`${i.key}_kg`]) ?? i.qty }))
      .filter((i) => i.qty > 0);
    const g = gate(items, ctx.procs, ctx.given, ctx.setup);
    const photo = r.source === "kobo" ? typeof p.list_photo === "string" && !!p.list_photo : !!p.photo;
    const signed = r.source === "kobo" ? p.signed === "yes" : typeof f.signature === "string" && !!f.signature && f.signature !== "Not confirmed";
    const flags = flagsFor({ farmerId: code_, items, photo, signed, step: r.source === "kobo" ? (farmer?.step ?? "unknown") : null }, othersThan(ctx.rows, r.id), planned);
    if (farmer && r.source === "kobo") await db.update(s.evidence).set({ payload: { ...p, _rop_gender: farmer.gender }, updatedAt: new Date() }).where(eq(s.evidence.id, r.id));
    const gender = farmer?.gender ?? (f.gender === "Female" || f.gender === "Male" ? f.gender : null);
    await prepare(code, project, r.id, { farmerId: code_, items, gender, village: farmer?.community ?? (typeof p.village === "string" ? p.village : ""), recordedBy, recorderId: r.source === "kobo" ? null : r.completedBy, photo, signed, gate: g, flags }, origin, undefined, r.source === "kobo");
    done++;
  }
  } finally {
    requestWrote();
  }
  return done;
}

/** A record made in the app stores the person's id; show their name (a Kobo account name stays as it is). */
async function recorderName(by: string | null) {
  if (!by) return "KoboCollect";
  return (await people()).find((u) => u.id === by)?.name ?? by;
}

/* ---------- 2–3. checks stored, manager told ---------- */

async function prepare(code: string, project: Project, id: string, m: Omit<DistMeta, "hash" | "expires" | "hashes">, origin: string, again?: { by: string; note: string }, fromKobo = false) {
  // A record from KoboCollect that still waits for its check is not sent to the project manager
  // yet: no email and no link until the check is made (checkKoboDistribution sends it then).
  const rule = fromKobo ? await koboApprovalFor(code) : null;
  // It goes to the project's managers, never to the person who recorded or collected it; when
  // they are the only manager, to the person they report to.
  const everyone = (await people()).filter((u) => onProject(u, code));
  const recorder = fromKobo ? collectorOf(m.recordedBy, rule!, everyone) : (m.recorderId ?? null);
  const { list: managers } = await approversFor(code, recorder);
  const held = !!rule && needsKoboCheck({ source: "kobo", koboChecked: m.koboChecked }, rule);
  const to = held ? [] : managers.filter((x) => x.email);
  // One link per manager: whoever uses theirs is the one the decision is recorded under.
  const tokens = new Map(to.map((x) => [x.user.id, randomBytes(24).toString("base64url")]));
  const meta: DistMeta = { ...m, hash: null, hashes: Object.fromEntries([...tokens].map(([who, t]) => [who, sha(t)])), expires: new Date(Date.now() + LINK_DAYS * 864e5).toISOString() };
  const linkFor = (who: string) => `${origin}/approve/${encodeURIComponent(code)}/${id}?t=${tokens.get(who)}`;
  let emailed = false;
  let why: string | undefined;
  const team = held ? (await people()).filter((u) => onProject(u, code)) : [];
  if (held) why = `Waiting for ${deciderNames(team, { fromKobo: true, collector: collectorOf(m.recordedBy, rule!, team) }, rule!)} to check the KoboCollect record first`;
  else if (!to.length) why = managers.length ? "No email address for the project manager in the staff list" : everyone.some((u) => u.field.includes("manager")) ? `Nobody can approve it yet: ${approverNamesOf(everyone, recorder)}` : "No project manager on this project";
  else if (!process.env.RESEND_API_KEY) why = "Email is not set up (RESEND_API_KEY)";
  else {
    try {
      const { send } = await import("@/server/notify-store");
      for (const x of to) await send(x.email!, approvalEmail(x.user.name, code, meta, linkFor(x.user.id), again));
      emailed = true;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
  }
  meta.notified = { to: held ? [] : managers.map((x) => x.user.id), at: new Date().toISOString(), emailed, ...(why ? { why } : {}) };
  await db.transaction(async (tx) => {
    await putMeta(tx, project.id, id, meta);
    // The farmer waits at "distribute" for the decision (Field activities shows it, Home skips it).
    await changeFarmer(tx, project.id, m.farmerId, (f) => (f.step === "distribute" ? { ...f, awaiting: { id, status: "pending" } } : null));
    await tx.insert(s.auditLog).values({ projectId: project.id, entity: "distribution", entityId: id, action: again ? "distribution_resubmitted" : fromKobo && m.koboChecked ? "distribution_sent_to_manager" : "distribution_recorded", detail: { farmer: m.farmerId, recordedBy: m.recordedBy, flags: meta.flags.map((f) => f.id), blocked: !meta.gate.ok, emailed, why: why ?? null, to: meta.notified!.to, ...(again ? { by: again.by, fixed: again.note, items: meta.items } : recorder ? { by: recorder } : {}) } });
  });
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function approvalEmail(name: string, code: string, m: DistMeta, link: string, again?: { by: string; note: string }) {
  const what = m.items.map((i) => qtyItem(i.qty, i.unit, i.item)).join(", ");
  const subject = `${m.gate.ok ? (again ? "Fixed, approval needed" : "Approval needed") : "On hold"}: input distribution in ${m.village || code}${m.flags.length ? ` (${m.flags.length} to check)` : ""}`;
  const fixed = again ? `You sent this back. ${again.by} fixed it and sent it again: ${again.note}` : "";
  const flags = m.flags.length ? m.flags.map((f) => f.text) : ["Nothing flagged."];
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#2B2B2B;max-width:560px">
<p>${esc(name.split(" ")[0])},</p>
<p>${esc(m.farmerId || "A farmer")} in ${esc(m.village || code)} (project ${esc(code)}) received the input package: ${esc(what)}. Recorded by ${esc(m.recordedBy)}.</p>${fixed ? `\n<p>${esc(fixed)}</p>` : ""}
<p style="margin-bottom:4px"><strong>Checks</strong></p><ul style="padding-left:18px;margin-top:0">${m.gate.lines.map((l) => `<li>${esc(l.detail)}</li>`).join("")}</ul>
<p style="margin-bottom:4px"><strong>To look at</strong></p><ul style="padding-left:18px;margin-top:0">${flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<p><a href="${link}" style="background:#314D2F;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">${m.gate.ok ? "Review and approve" : "View details"}</a></p>
<p style="color:#6B7280;font-size:12px">The link works once and for ${LINK_DAYS} days. Farmer IDs only: names stay in the app.</p></div>`;
  const text = [`${name.split(" ")[0]},`, "", `${m.farmerId || "A farmer"} in ${m.village || code} (project ${code}) received the input package: ${what}. Recorded by ${m.recordedBy}.`, ...(fixed ? ["", fixed] : []), "", "Checks:", ...m.gate.lines.map((l) => `- ${l.detail}`), "", "To look at:", ...flags.map((f) => `- ${f}`), "", link].join("\n");
  return { subject, html, text };
}

/* ---------- what the approval page and Home show ---------- */

export type DistView = {
  id: string;
  farmerId: string;
  village: string;
  date: string;
  source: "app" | "kobo";
  recordedBy: string;
  items: DistItem[];
  gender: string | null;
  photo: boolean;
  signed: boolean;
  /** From KoboCollect: the condition recorded at handover when it was not acceptable, until a fix puts it right. */
  condition: string | null;
  gate: Gate;
  flags: Flag[];
  status: "pending" | "accepted" | "queried";
  /** The day it began waiting for its present decision: when it reached the app, or when its last fix was sent back in. */
  waitingSince: string;
  notified: DistMeta["notified"] | null;
  /** From KoboCollect: whether it still waits for its check, who gives it, and who gave it. */
  koboCheck: { needed: boolean; by: string; /** Person ids who may make the check. */ who: string[]; done: DistMeta["koboChecked"] | null };
  decided: DistMeta["decided"] | null;
  history: NonNullable<DistMeta["history"]>;
  /** The farmer's package as planned, so a fix can add an item that was recorded as not given. */
  planned: DistItem[];
  /** Who may approve it or send it back (person ids), and their names in words: never its recorder. */
  approvers: string[];
  approverNames: string;
  /** Why it cannot close yet apart from the goods received checks (the recipient's signed note); null when it may. */
  closeBlock: string | null;
};

const photoOf = (r: { source: string; payload: unknown }) => {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return r.source === "kobo" ? typeof p.list_photo === "string" && !!p.list_photo : !!p.photo;
};
/** The condition at handover as the KoboCollect form recorded it; null from the app, where the recipient's tick covers it. */
const conditionOf = (r: { source: string; payload: unknown }) => {
  const c = ((r.payload ?? {}) as Record<string, unknown>).condition;
  return r.source === "kobo" && typeof c === "string" && c ? c : null;
};
const sourceOf = (r: { source: string }) => (r.source === "kobo" ? ("kobo" as const) : ("app" as const));

const signedOf = (r: { source: string; payload: unknown }) => {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const f = (typeof p.fields === "object" && p.fields ? p.fields : p) as Record<string, unknown>;
  return r.source === "kobo" ? p.signed === "yes" : typeof f.signature === "string" && !!f.signature && f.signature !== "Not confirmed";
};

export async function listDistributions(code: string): Promise<DistView[]> {
  const project = await projectByCode(code);
  // What processing waiting records does not change (the rule, the team, purchases, the package)
  // is read alongside it; the records, their checks and the field records after it, as they may
  // have just been written.
  const [, rule, everyone, procRows, setup] = await Promise.all([processPending(code), koboApprovalFor(code), people(), procurementRows(project.id), setupOrEmpty(project)]);
  const [rows, st, fieldRows] = await Promise.all([distributionRows(project.id), loadState(project.id), fieldItemRows(project.id)]);
  const team = everyone.filter((u) => onProject(u, code));
  const approvers = approverNames(team, rule);
  const procs = procRows.map((r) => r.data as Procurement);
  // What approved distributions have taken so far, for the checks of the ones still waiting.
  const approved: Given = {};
  for (const r of rows) if (r.reviewStatus === "accepted" && !r.koboRemovedAt) addGiven(approved, st.byId[r.id]?.items ?? itemsFor(setup), setup);
  const hectares = new Map(fieldRows.map((r) => [r.key, (r.data as { hectares?: number }).hectares]));
  // Farmers whose record now holds a photo of the signed note: a record still waiting counts it at once.
  const noted = new Set(fieldRows.filter((r) => hasSignedNotePhoto(r.data as Farmer)).map((r) => r.key));
  const photoNow = (r: { source: string; payload: unknown; farmerCode: string | null; reviewStatus: string }, m: DistMeta) => (m.photo ?? photoOf(r)) || (r.reviewStatus === "pending" && noted.has(r.farmerCode ?? ""));
  return rows
    .filter((r) => st.byId[r.id] && !r.koboRemovedAt)
    .map((r) => {
      const m = st.byId[r.id];
      return {
        id: r.id,
        farmerId: r.farmerCode ?? "",
        village: m.village,
        date: (r.completedAt ?? r.createdAt).toISOString().slice(0, 10),
        source: r.source === "kobo" ? ("kobo" as const) : ("app" as const),
        recordedBy: m.recordedBy,
        items: m.items,
        gender: m.gender,
        photo: photoNow(r, m),
        signed: m.signed ?? signedOf(r),
        condition: m.conditionOk ? null : badCondition(conditionOf(r)),
        // While it waits, the checks are worked out now, as approving will: a goods received note
        // signed since the record was made shows at once. Once decided, they stay as they were then.
        gate: r.reviewStatus === "pending" ? gate(m.items, procs, approved, setup) : m.gate,
        flags: m.flags,
        status: r.reviewStatus,
        waitingSince: [r.createdAt.toISOString(), ...(m.history ?? []).map((h) => h.fixed.at)].sort().at(-1)!.slice(0, 10),
        notified: m.notified ?? null,
        koboCheck: (() => {
          const rec = { fromKobo: true, collector: r.source === "kobo" ? collectorOf(r.completedBy, rule, team) : null };
          return { needed: r.reviewStatus === "pending" && needsKoboCheck({ source: r.source, koboChecked: m.koboChecked }, rule), by: r.source === "kobo" ? deciderNames(team, rec, rule) : approvers, who: r.source === "kobo" ? decidersOf(team, rec, rule).map((p) => p.id) : [], done: m.koboChecked ?? null };
        })(),
        decided: m.decided ?? null,
        history: m.history ?? [],
        planned: itemsFor(setup, hectares.get(r.farmerCode ?? "")),
        approvers: approversOf(team, recorderOf(r, m, rule, team)).map((p) => p.id),
        approverNames: approverNamesOf(team, recorderOf(r, m, rule, team)),
        closeBlock: closeBlock({ signed: m.signed ?? signedOf(r), photo: photoNow(r, m), source: sourceOf(r), condition: m.conditionOk ? null : conditionOf(r) }),
      };
    })
    .sort((a, b) => (a.status === b.status ? b.date.localeCompare(a.date) : a.status === "pending" ? -1 : 1));
}

/**
 * Whether a link's token opens this distribution, and whose link it is: `{ who }` is the manager it
 * was emailed to (null for an older record, whose managers shared one link). Null when it does not
 * open it: wrong, used or expired.
 */
export async function tokenOpens(code: string, id: string, token: string): Promise<{ who: string | null } | null> {
  const project = await projectByCode(code);
  const m = (await loadState(project.id)).byId[id];
  if (!m || !token || m.expires < new Date().toISOString()) return null;
  const given = Buffer.from(sha(token), "hex");
  const same = (hex: string) => {
    const a = Buffer.from(hex, "hex");
    return a.length === given.length && timingSafeEqual(a, given);
  };
  const mine = Object.entries(m.hashes ?? {}).find(([, h]) => same(h));
  if (mine) return { who: mine[0] };
  return m.hash && same(m.hash) ? { who: null } : null;
}

/* ---------- 3b. a KoboCollect record is checked first ---------- */

/**
 * The check on a distribution that came from KoboCollect, by whoever the project names for
 * KoboCollect data. Until it is made, the project manager cannot approve the record. Made once;
 * a record sent back and fixed keeps it.
 */
/** Who may make the check on this KoboCollect distribution: the project's approvers, never its collector (lib/kobo-approval). */
export async function koboCheckers(code: string, account: string | null) {
  const rule = await koboApprovalFor(code);
  const team = (await people()).filter((u) => onProject(u, code));
  const rec = { fromKobo: true, collector: collectorOf(account, rule, team) };
  return { team, rule, rec, who: decidersOf(team, rec, rule) };
}

export async function checkKoboDistribution(code: string, id: string, by: { id: string; name: string }, origin = appOrigin()) {
  const project = await projectByCode(code);
  const [row] = await db.select().from(s.evidence).where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"))).limit(1);
  if (!row) throw new HttpError(404, "That distribution is not on this project.");
  if (row.source !== "kobo") throw new HttpError(409, "This distribution was recorded in the app, so it goes straight to the project manager.");
  const c = await koboCheckers(code, row.completedBy);
  const why = refusalFor(by, c.team, c.rec, c.rule);
  if (why) throw new HttpError(403, why);
  if (row.reviewStatus !== "pending") throw new HttpError(409, "This distribution has already been decided.");
  const m = (await loadState(project.id)).byId[id];
  if (!m) throw new HttpError(409, "This distribution has not been read in yet. Sync Kobo and try again.");
  if (m.koboChecked) return m.koboChecked;
  const koboChecked = { by: by.id, byName: by.name, at: new Date().toISOString() };
  await db.transaction(async (tx) => {
    await putMeta(tx, project.id, id, { ...m, koboChecked });
    await tx.insert(s.auditLog).values({ projectId: project.id, entity: "distribution", entityId: id, action: "distribution_kobo_checked", detail: { by: by.id, farmer: row.farmerCode } });
  });
  // Now it goes to the project manager: the approval email and its link, held until this moment.
  await prepare(code, project, id, { ...m, koboChecked }, origin, undefined, true);
  return koboChecked;
}

/* ---------- 4. approved or sent back ---------- */

/**
 * Whether this person could approve distributions on the project at all: staff who work on it.
 * Whether they may decide one distribution is settled on the record itself (lib/distribution
 * approversOf): its managers, never whoever recorded it, else the person the recorder reports to.
 */
export const mayApprove = (u: AppUser, code: string) => u.kind === "employee" && onProject(u, code);

/**
 * The manager's decision. Approving re-runs the gate against what has been approved so far, then in
 * one transaction: the record counts (MEL, donor report), the purchase's distribution list grows,
 * finance gets a ready-to-pay task, and the audit log has it all.
 */
export async function decideDistribution(code: string, id: string, decision: "approved" | "sent_back", by: { id: string; name: string }, note?: string) {
  const project = await projectByCode(code);
  const [row] = await db.select().from(s.evidence).where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"))).limit(1);
  if (!row) throw new HttpError(404, "That distribution is not on this project.");
  if (row.reviewStatus !== "pending") throw new HttpError(409, `This distribution was already ${row.reviewStatus === "accepted" ? "approved" : "sent back"}.`);
  const ctx = await context(project, { excluding: id, countPending: false });
  const m = ctx.st.byId[id];
  if (!m) throw new HttpError(409, "This distribution has not been checked yet. Sync Kobo and try again.");
  if (decision === "sent_back" && !note?.trim()) throw new HttpError(400, "Say what needs fixing, so the person who recorded it knows.");
  // Inputs go only to farmers selected in Farmer selection (or not yet decided): enforced here, not only by the page.
  const hold = decision === "approved" ? selectionHold(await selectionOutcomes(project.id), row.farmerCode) : null;
  if (hold) throw new HttpError(409, `Not approved: ${hold}. Select them first, or send this distribution back.`);
  // From KoboCollect: checked first by whoever this project names for KoboCollect data.
  const rule = await koboApprovalFor(code);
  if (decision === "approved" && needsKoboCheck({ source: row.source, koboChecked: m.koboChecked }, rule))
    throw new HttpError(409, `Not approved yet: this record came from KoboCollect, and ${approverNames((await people()).filter((u) => onProject(u, code)), rule)} checks KoboCollect data on this project before it is approved.`);

  // Nobody approves a distribution they recorded or collected themselves.
  const everyone = (await people()).filter((u) => onProject(u, code));
  const refused = by.id === "manager-link" ? null : approvalRefusal(by.id, everyone, recorderOf(row, m, rule, everyone));
  if (refused) throw new HttpError(403, refused);

  const g = gate(m.items, ctx.procs, ctx.given, ctx.setup);
  if (decision === "approved" && !g.ok) throw new HttpError(409, `Not approved: ${g.block}`);
  // The signed note closes it: no approval while the recipient's signature is not confirmed.
  const unsigned = decision === "approved" ? closeBlock({ signed: m.signed ?? signedOf(row), photo: (m.photo ?? photoOf(row)) || hasSignedNotePhoto(row.farmerCode ? await farmerOf(project.id, row.farmerCode) : null), source: sourceOf(row), condition: m.conditionOk ? null : conditionOf(row) }) : null;
  if (unsigned) throw new HttpError(409, `Not approved: ${unsigned}`);

  const finance = decision === "approved" ? (await people()).filter((u) => u.procurement.includes("finance") && onProject(u, code))[0] : undefined;
  // Sent back to the person who recorded it; to the storekeeper or extension agent when that was a phone in the field.
  const fixer = decision === "sent_back" ? fixOwner(m.recorderId ?? row.completedBy, (await people()).filter((u) => onProject(u, code))) : null;
  const now = new Date();
  const day = today();
  const changed: string[] = [];
  const team = decision === "approved" ? await people() : [];
  // The target approved distributions count toward (lib/package `target`), when the project has
  // named one and it takes recorded results.
  // A target that counts at planting is counted when planting is recorded (countPlanting), not here.
  const counts = decision === "approved" && ctx.setup.target && !countsAtPlanting(ctx.setup) ? ((await db.select({ code: s.indicators.code, name: s.indicators.name }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, ctx.setup.target), eq(s.indicators.source, "results"))).limit(1))[0] ?? null) : null;
  let result: string | null = null;

  await db.transaction(async (tx) => {
    if (decision === "approved") {
      // Checked again under the stock lock: another approval may have just used the stock.
      await lockStock(tx, project.id);
      const now2 = await context(project, { excluding: id, countPending: false }, tx);
      const again = gate(m.items, now2.procs, now2.given, now2.setup);
      if (!again.ok) throw new HttpError(409, `Not approved: ${again.block}`);
    }
    await tx
      .update(s.evidence)
      .set({ reviewStatus: decision === "approved" ? "accepted" : "queried", reviewedBy: by.id, reviewedAt: now, queryNote: decision === "sent_back" ? note!.trim() : null, updatedAt: now })
      .where(eq(s.evidence.id, id));

    if (decision === "approved") {
      // Procurement: the purchase's distribution list. One entry per day and village, added to.
      const rows = await tx.select().from(s.procurements).where(eq(s.procurements.projectId, project.id));
      for (const it of m.items) {
        // The received purchase this item comes from (oldest with enough left), read inside the
        // transaction so an earlier item's update in this loop is seen.
        const current = (await tx.select().from(s.procurements).where(eq(s.procurements.projectId, project.id))).map((x) => x.data as Procurement);
        const supplier = drawnFrom(lineOf(it, ctx.setup), it.qty, it.unit, current);
        const r = supplier && rows.find((x) => x.procKey === supplier.id);
        if (!r || !supplier) continue;
        const p = supplier;
        const d = p.distribution ?? { forParticipants: true, lists: [], inStock: 0, checks: [] };
        const qty = inProcUnit(it.qty, it.unit, p);
        const place = m.village || "Not recorded";
        const at = d.lists.findIndex((l) => l.date === day && l.place === place && l.by === by.id);
        const lists = [...d.lists];
        const women = m.gender === "Female" ? 1 : 0;
        if (at >= 0) lists[at] = { ...lists[at], recipients: lists[at].recipients + 1, women: lists[at].women + women, qty: lists[at].qty + qty };
        else lists.push({ date: day, place, recipients: 1, women, qty, evidence: `ROP Workflow distribution records, approved by ${by.name}`, by: by.id, byName: by.name, viaField: true });
        const next: Procurement = { ...p, rev: (p.rev ?? 0) + 1, distribution: { ...d, forParticipants: true, lists } };
        await tx.update(s.procurements).set({ data: next, updatedAt: now }).where(eq(s.procurements.id, r.id));
        changed.push(p.id);
        // Finance: the goods are in and going out, so the supplier's invoice can be paid.
        // Not for a purchase already paid or closed: there is nothing left to release.
        if (!paymentDue(p)) continue;
        await tx
          .insert(s.workItems)
          .values({
            organizationId: project.organizationId,
            projectId: project.id,
            type: "task",
            title: `Pay ${p.supplier?.name ?? "the supplier"} for ${p.id} (${p.title}): goods received and distributions approved`,
            date: day,
            assignee: finance?.id ?? null,
            createdBy: by.id,
            sourceKey: `pay-ready:${p.id}`,
            notes: `The goods received note is signed and the project manager has approved distributions from it. Match the invoice to the purchase order and the goods received note, then release payment.`,
          })
          .onConflictDoNothing();
      }
      // Results: the distribution counts toward the target the input package names, once, waiting
      // for MEL like any other result. The same for one recorded in the app and one from
      // KoboCollect: a distribution form is never mapped to a target in the KoboToolbox setup
      // (server/kobo-results skips it), so this is the one place a distribution is counted.
      if (counts && row.farmerCode) {
        const recorder = team.find((u) => u.id === (row.source === "kobo" ? collectorOf(row.completedBy, rule, team) : (m.recorderId ?? row.completedBy)));
        const input = resultFor({ id, farmerId: row.farmerCode, village: m.village, gender: m.gender ?? undefined, date: (row.completedAt ?? now).toISOString().slice(0, 10), items: m.items, recordedBy: recorder?.name ?? "the field team", approvedBy: by.name }, counts.code);
        const made = await insertResult(tx, project, input, recorder?.id ?? (row.source === "kobo" ? by.id : (row.completedBy ?? by.id)));
        result = made.id;
      }
      // Field: approval is what moves the farmer on to planting, from the app or KoboCollect alike.
      if (row.farmerCode)
        await changeFarmer(tx, project.id, row.farmerCode, (f) => {
          if (f.step !== "distribute") return f.awaiting?.id === id ? { ...f, awaiting: undefined } : null;
          // Approval needs the recipient's signature and the photo of the signed note (closeBlock), so it is ticked here.
          return { ...f, step: "plant", awaiting: undefined, checks: { ...f.checks, "distribute.recipient": true }, timeline: [...f.timeline, { date: day, who: "manager", what: `Distribution${row.source === "kobo" ? " (KoboCollect)" : ""} approved by ${by.name}: moved to planting` }] };
        });
    } else {
      await tx
        .insert(s.workItems)
        .values({
          organizationId: project.organizationId,
          projectId: project.id,
          type: "task",
          title: `Fix the distribution record for ${row.farmerCode ?? "a farmer"}: ${note!.trim().slice(0, 120)}`,
          date: day,
          assignee: fixer,
          createdBy: by.id,
          sourceKey: `dist-fix:${id}`,
          notes: fixNotes(code, id, by.name, note!.trim()),
        })
        // Sent back a second time: the same task opens again with the new reason.
        .onConflictDoUpdate({
          target: [s.workItems.projectId, s.workItems.sourceKey],
          set: { title: `Fix the distribution record for ${row.farmerCode ?? "a farmer"}: ${note!.trim().slice(0, 120)}`, date: day, assignee: fixer, notes: fixNotes(code, id, by.name, note!.trim()), doneAt: null, doneBy: null, updatedAt: now },
        });
      // The farmer stays at "distribute", showing why it came back, until it is fixed and approved.
      if (row.farmerCode)
        await changeFarmer(tx, project.id, row.farmerCode, (f) =>
          f.step === "distribute" ? { ...f, awaiting: { id, status: "sent_back", note: note!.trim() }, timeline: [...f.timeline, { date: day, who: "manager", what: `Distribution sent back by ${by.name}: ${note!.trim()}` }] } : null,
        );
    }

    await tx.insert(s.auditLog).values({
      projectId: project.id,
      entity: "distribution",
      entityId: id,
      action: decision === "approved" ? "distribution_approved" : "distribution_sent_back",
      detail: { by: by.id, farmer: row.farmerCode, items: m.items, procurements: changed, ...(result ? { result, target: counts?.code } : {}), flags: m.flags.map((f) => f.id), note: note ?? null, ...(decision === "sent_back" ? { to: fixer } : {}) },
    });
    // The link is used up and the decision kept with the record, in the same step as the decision itself.
    await putMeta(tx, project.id, id, { ...m, gate: g, hash: null, hashes: {}, decided: { by: by.id, byName: by.name, at: now.toISOString(), decision, ...(note ? { note: note.trim() } : {}) } });
  });
  return { decision, procurements: changed, fixer, result, target: counts?.code ?? null, targetName: counts?.name ?? null };
}

const fixNotes = (code: string, id: string, by: string, note: string) => `Sent back by ${by}: ${note}\nOpen ${appOrigin()}/approve/${encodeURIComponent(code)}/${id}, correct what was recorded and send it again.`;

/* ---------- 5. fixed and sent again ---------- */

/**
 * The fix for a distribution the manager sent back: the corrected quantities, signature and photo
 * replace what was recorded, the record waits for the manager again with fresh checks and a new
 * link, and the fix task closes. What was sent back and why stays in the record's history.
 */
export async function resubmitDistribution(code: string, id: string, by: { id: string; name: string }, fix: Fix, note: string, origin = appOrigin()) {
  const project = await projectByCode(code);
  if (!note.trim()) throw new HttpError(400, "Say what you fixed, so the project manager knows what changed.");
  const ctx = await context(project, { excluding: id, countPending: true });
  const m = ctx.st.byId[id];
  const now = new Date();
  const row = await db.transaction(async (tx) => {
    // Only while still sent back: two people fixing it at once cannot both send it.
    const [r] = await tx
      .update(s.evidence)
      .set({ reviewStatus: "pending", reviewedBy: null, reviewedAt: null, queryNote: null, updatedAt: now })
      .where(and(eq(s.evidence.id, id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"), eq(s.evidence.reviewStatus, "queried")))
      .returning();
    if (!r) return null;
    await tx.update(s.workItems).set({ doneAt: now, doneBy: by.id, updatedAt: now }).where(and(eq(s.workItems.projectId, project.id), eq(s.workItems.sourceKey, `dist-fix:${id}`)));
    return r;
  });
  if (!row || !m) throw new HttpError(409, "Only a distribution the project manager sent back can be fixed and sent again. Reload to see where it stands.");
  const farmer = row.farmerCode ? await farmerOf(project.id, row.farmerCode) : null;
  const planned = itemsFor(ctx.setup, farmer?.hectares);
  const items = applyFix(m.items, fix, planned);
  // From the app the photo is the one on the farmer's record, looked at again now: a tick is not
  // a document. From KoboCollect the image came with the form; a fix can say it has since been added.
  const photo = row.source === "kobo" ? (fix.photo ?? m.photo ?? photoOf(row)) || hasSignedNotePhoto(farmer) : hasSignedNotePhoto(farmer) || !!m.photo;
  const signed = fix.signed ?? m.signed ?? signedOf(row);
  const conditionOk = fix.conditionOk ?? m.conditionOk;
  const flags = flagsFor({ farmerId: row.farmerCode ?? m.farmerId, items, photo, signed, step: row.source === "kobo" ? (farmer?.step ?? "unknown") : null }, ctx.others, planned);
  const history = [...(m.history ?? []), ...(m.decided ? [{ sentBack: m.decided, fixed: { by: by.id, byName: by.name, at: now.toISOString(), note: note.trim() } }] : [])];
  const { decided: _decided, hash: _hash, hashes: _hashes, expires: _expires, notified: _notified, ...kept } = m;
  void [_decided, _hash, _hashes, _expires, _notified];
  await prepare(code, project, id, { ...kept, items, photo, signed, ...(conditionOk === undefined ? {} : { conditionOk }), gate: gate(items, ctx.procs, ctx.given, ctx.setup), flags, history }, origin, { by: by.name, note: note.trim() }, row.source === "kobo");
  return { ok: true as const };
}

/* ---------- readiness "No": a task for the extension agent ---------- */

/**
 * Who gets the correction after a readiness "No". `account` is the KoboCollect account that sent
 * the readiness form: when the project has matched it to an extension agent, the agent who made
 * the visit; otherwise the first extension agent on the project. Read before the decision's
 * transaction opens, never inside it: a read on a second connection there can wait for ever.
 */
export async function correctionOwner(code: string, account: string | null): Promise<string | null> {
  const agents = (await people()).filter((u) => u.field.includes("extension") && onProject(u, code));
  const visited = account ? collectorOf(account, await koboApprovalFor(code), agents) : null;
  return (agents.find((u) => u.id === visited) ?? agents[0])?.id ?? null;
}

/** Called inside the readiness decision: a correction task with the deadline, for `assignee` (correctionOwner). */
export async function correctionTask(tx: Tx, project: { id: string; organizationId: string | null; code: string }, farmerCode: string, issue: string, deadline: string, evidenceId: string, by: string, assignee: string | null) {
  await tx
    .insert(s.workItems)
    .values({
      organizationId: project.organizationId,
      projectId: project.id,
      type: "task",
      title: `Correction for ${farmerCode}: ${issue.slice(0, 120)}`,
      date: deadline,
      assignee,
      createdBy: by,
      sourceKey: `correction:${evidenceId}`,
      notes: `Readiness check said No. Help the farmer fix this, then record the recheck in KoboCollect by ${deadline}: ${issue}`,
    })
    .onConflictDoNothing();
}

/**
 * When the project first names (or changes) the target distributions count toward, the ones the
 * project manager already approved are counted too, so nobody types them again on the Results
 * page. Each becomes one result waiting for MEL, exactly as at approval; one already counted is
 * never counted twice. Returns how many were added.
 */
export async function countApprovedDistributions(code: string, target: string): Promise<number> {
  const project = await projectByCode(code);
  if (countsAtPlanting(await setupOf(project))) return countPlantedFarmers(code, target);
  const indicator = (await db.select({ code: s.indicators.code }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, target), eq(s.indicators.source, "results"))).limit(1))[0];
  if (!indicator) return 0;
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"), eq(s.evidence.reviewStatus, "accepted")));
  if (!rows.length) return 0;
  const counted = new Set(
    (await db.select({ payload: s.evidence.payload }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"))))
      .map((r) => (r.payload as { distribution?: string; indicator?: string } | null))
      .filter((p) => p?.distribution && p.indicator === target)
      .map((p) => p!.distribution!),
  );
  // A farmer already counted from their planting (when the target counted at planting before) is not counted again.
  const planted = new Set(
    (await db.select({ payload: s.evidence.payload }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"))))
      .map((r) => r.payload as { planting?: string; indicator?: string } | null)
      .filter((p) => p?.planting && p.indicator === target)
      .map((p) => p!.planting!),
  );
  const st = await loadState(project.id);
  const team = await people();
  const rule = await koboApprovalFor(code);
  let added = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const m = st.byId[row.id];
      if (!m || row.koboRemovedAt || !row.farmerCode || counted.has(row.id) || planted.has(row.farmerCode) || m.decided?.decision !== "approved") continue;
      const recorder = team.find((u) => u.id === (row.source === "kobo" ? collectorOf(row.completedBy, rule, team) : (m.recorderId ?? row.completedBy)));
      const input = resultFor({ id: row.id, farmerId: row.farmerCode, village: m.village, gender: m.gender ?? undefined, date: (row.completedAt ?? new Date()).toISOString().slice(0, 10), items: m.items, recordedBy: recorder?.name ?? "the field team", approvedBy: m.decided.byName }, target);
      await insertResult(tx, project, input, recorder?.id ?? m.decided.by);
      added += 1;
    }
  });
  return added;
}

/* ---------- a recorded planting counts toward a target ---------- */

/**
 * The farmers already counted toward a target: by a result made from their planting, or from one
 * of their distributions. A farmer counts once, whichever way the project counted them before.
 */
async function farmersCounted(tx: Tx | typeof db, projectId: string, target: string): Promise<Map<string, { how: "handout" | "planting"; date: string }>> {
  const results = (await tx.select({ payload: s.evidence.payload }).from(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.form, "result"))))
    .map((r) => r.payload as { distribution?: string; planting?: string; indicator?: string; date?: string } | null)
    .filter((p) => p?.indicator === target);
  const out = new Map<string, { how: "handout" | "planting"; date: string }>();
  for (const p of results) if (p!.planting) out.set(p!.planting, { how: "planting", date: p!.date ?? "" });
  const dists = new Map(results.filter((p) => p!.distribution).map((p) => [p!.distribution!, p!.date ?? ""]));
  if (dists.size)
    for (const row of await tx.select({ id: s.evidence.id, farmer: s.evidence.farmerCode }).from(s.evidence).where(and(eq(s.evidence.projectId, projectId), eq(s.evidence.form, "distribution"))))
      if (dists.has(row.id) && row.farmer && !out.has(row.farmer)) out.set(row.farmer, { how: "handout", date: dists.get(row.id)! });
  return out;
}

/** The target a recorded planting counts toward: read before a transaction opens (countPlantingIn). */
export type PlantingTarget = { project: Project; setup: FieldSetup; target: string; indicator: { code: string; name: string; unit: string } };

/** The project's target that counts at planting (lib/package targetAt), or null when it has none. */
export async function plantingTarget(code: string): Promise<PlantingTarget | null> {
  const project = await projectByCode(code);
  const setup = await setupOf(project);
  if (!setup || !countsAtPlanting(setup)) return null;
  const target = setup.target!;
  const indicator = (await db.select({ code: s.indicators.code, name: s.indicators.name, unit: s.indicators.unit }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, target), eq(s.indicators.source, "results"))).limit(1))[0];
  return indicator ? { project, setup, target, indicator } : null;
}

/**
 * When the project's target counts at planting, recording a farmer's planting adds them to it: one
 * result waiting for MEL, never twice for the same farmer. Runs inside the transaction that records
 * the planting (server/review decide), so the planting and its count are saved together or not at
 * all. Either way the farmer's history says what happened, so the extension agent sees it at once.
 * Returns the result's id when one was made, or `already` when the farmer was counted before.
 */
export async function countPlantingIn(tx: Tx, t: PlantingTarget, f: Farmer, by: { id: string; name: string }): Promise<{ result: string | null; already: boolean } | null> {
  if (!f.planting) return null;
  const before = (await farmersCounted(tx, t.project.id, t.target)).get(f.id);
  const r = before ? null : await insertResult(tx, t.project, resultForPlanting({ ...f, planting: f.planting }, t.target, { crop: t.setup.crop, recordedBy: by.name, unit: t.indicator.unit, plan: t.setup.plan }), by.id);
  const what = before
    ? `Already counted toward "${t.indicator.name}" ${before.how === "handout" ? "when the package was handed out" : "from an earlier planting"}${before.date ? ` (${before.date})` : ""}: not counted again`
    : `Counted toward "${t.indicator.name}": waiting for MEL to accept it on the Results page`;
  await changeFarmer(tx, t.project.id, f.id, (x) => ({ ...x, timeline: [...x.timeline, { date: today(), who: "system", what, by: "ROP Workflow" }] }));
  return { result: r?.id ?? null, already: !!before };
}

/** countPlantingIn in a transaction of its own, for a planting already saved; null when no target counts at planting. */
export async function countPlanting(code: string, f: Farmer, by: { id: string; name: string }) {
  const t = await plantingTarget(code);
  return t && f.planting ? db.transaction((tx) => countPlantingIn(tx, t, f, by)) : null;
}

/**
 * When a target that counts at planting is first named (or switched to planting), the farmers
 * whose planting is already recorded are counted, once each. Returns how many were added.
 */
export async function countPlantedFarmers(code: string, target: string): Promise<number> {
  const project = await projectByCode(code);
  const setup = await setupOf(project);
  const indicator = (await db.select({ code: s.indicators.code, unit: s.indicators.unit }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, target), eq(s.indicators.source, "results"))).limit(1))[0];
  if (!indicator) return 0;
  const rows = await db.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, project.id), eq(s.fieldItems.kind, "farmer")));
  const planted = rows.map((r) => r.data as Farmer).filter((f) => f.step === "complete" && !!f.planting);
  if (!planted.length) return 0;
  const team = await people();
  let added = 0;
  await db.transaction(async (tx) => {
    const counted = await farmersCounted(tx, project.id, target);
    for (const f of planted) {
      if (counted.has(f.id)) continue;
      // The person who recorded the planting, from the history; the field team when not known.
      const who = [...f.timeline].reverse().find((t) => t.what.startsWith("Planting recorded"));
      const by = team.find((u) => u.name === (who as { by?: string } | undefined)?.by) ?? team.find((u) => u.field?.includes("extension") && onProject(u, code));
      await insertResult(tx, project, resultForPlanting({ ...f, planting: f.planting! }, target, { crop: setup?.crop, recordedBy: by?.name ?? "the field team", unit: indicator.unit, plan: setup?.plan }), by?.id ?? "system");
      added += 1;
    }
  });
  return added;
}
