import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { today } from "@/lib/clock";
import type { AppUser } from "@/lib/demo";
import { addGiven, applyFix, drawnFrom, fixOwner, flagsFor, gate, inProcUnit, lineOf, paymentDue, storeStock, type DistItem, type Fix, type Flag, type Gate, type Given } from "@/lib/distribution";
import { itemsFor, type FieldSetup } from "@/lib/package";
import type { Farmer } from "@/lib/field";
import type { Procurement } from "@/lib/procurement";
import type { Submission } from "@/lib/project";
import { demoMode, onProject, people, toAppUser } from "@/server/auth";
import { projectByCode, setupOf } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { loadProjectState } from "@/server/project-state";

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
  /** sha256 of the approval link's token; cleared once used. */
  hash: string | null;
  expires: string;
  /** Whether the signed list was photographed and the recipient's signature confirmed, once a fix has said so. */
  photo?: boolean;
  signed?: boolean;
  /** Person id of who recorded it, when that is a person in the app (not a Kobo username). */
  recorderId?: string | null;
  notified?: { to: string[]; at: string; emailed: boolean; why?: string };
  decided?: { by: string; byName: string; at: string; decision: "approved" | "sent_back"; note?: string };
  /** Earlier rounds: each send-back with what was fixed in answer, oldest first. */
  history?: { sentBack: NonNullable<DistMeta["decided"]>; fixed: { by: string; byName: string; at: string; note: string } }[];
};
type State = { byId: Record<string, DistMeta> };

const loadState = async (projectId: string) => loadProjectState<State>(projectId, KEY, { byId: {} });

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
const setupOrEmpty = async (project: Project): Promise<FieldSetup> => (await setupOf(project)) ?? { items: [] };

/** Everything the gate needs: the package, the purchases, and what each earlier distribution took. */
async function context(project: Project, opts: { excluding?: string; countPending: boolean }) {
  const setup = await setupOrEmpty(project);
  const procs = (await db.select().from(s.procurements).where(eq(s.procurements.projectId, project.id))).map((r) => r.data as Procurement);
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution")));
  const st = await loadState(project.id);
  const given: Given = {};
  const others: string[] = [];
  for (const r of rows) {
    if (r.id === opts.excluding || r.koboRemovedAt || r.reviewStatus === "queried") continue;
    if (r.farmerCode) others.push(r.farmerCode);
    if (r.reviewStatus === "pending" && !opts.countPending) continue;
    // A record with no items stored (made before quantities were kept) is one planned package.
    addGiven(given, st.byId[r.id]?.items ?? itemsFor(setup), setup);
  }
  return { setup, procs, given, others, st, rows };
}

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

async function farmerOf(projectId: string, code: string) {
  const [item] = await db.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, projectId), eq(s.fieldItems.itemKey, code))).limit(1);
  return item ? (item.data as Farmer) : null;
}

/** People on the project with a field role, with their email where the staff list has one. */
async function holders(code: string, role: "manager" | "extension" | "store") {
  const list = (await people()).filter((u) => u.field.includes(role) && onProject(u, code));
  const rows = await db.select().from(s.staff).where(eq(s.staff.active, true));
  const email = new Map(rows.filter((r) => r.personId && r.profile && r.email).map((r) => [toAppUser(r).id, r.email!]));
  // Demo mode: the fictional people have no addresses, so NOTIFY_TEST_TO receives their mail for testing.
  const test = demoMode() ? process.env.NOTIFY_TEST_TO?.trim() || null : null;
  return list.map((u) => ({ user: u, email: test ?? email.get(u.id) ?? null }));
}

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
  const ctx = await context(project, { countPending: true });
  if (!ctx.setup.items.length) throw new HttpError(409, `${code} has no input package set up yet. The project manager sets it up in Field activities.`);
  const items = itemsFor(ctx.setup, farmer.hectares);
  const g = gate(items, ctx.procs, ctx.given, ctx.setup);
  if (!g.ok) throw new HttpError(409, `${farmer.id}'s input package can't be recorded as handed out yet. ${g.block}`);
  // Saved twice (a retry, a double tap, a lost connection): the distribution already waiting for
  // this farmer is this one. Nothing new is stored and the manager is not emailed again.
  const waiting = ctx.rows.find((r) => r.farmerCode === farmer.id && r.reviewStatus === "pending" && !r.koboRemovedAt && r.source === "manual" && (r.payload as { source?: string } | null)?.source === "app");
  if (waiting) return waiting.id;
  const signed = !!farmer.checks["distribute.recipient"];
  const photo = farmer.photos.some((p) => p.activity === "distribution");
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
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: project.organizationId, projectId: project.id, source: "manual", form: "distribution", farmerCode: farmer.id, reviewStatus: "pending", completedBy: user.id, completedAt: new Date(), location: farmer.community, payload: sub })
    .returning({ id: s.evidence.id });
  const flags = flagsFor({ farmerId: farmer.id, items, photo, signed, step: null }, ctx.others, items);
  await prepare(code, project, row.id, { farmerId: farmer.id, items, gender: farmer.gender, village: farmer.community, recordedBy: user.name, recorderId: user.id, photo, signed, gate: g, flags }, origin);
  return row.id;
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
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution"), eq(s.evidence.reviewStatus, "pending")));
  let done = 0;
  for (const r of rows) {
    const ctx = await context(project, { excluding: r.id, countPending: false });
    if (ctx.st.byId[r.id] || r.koboRemovedAt) continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    // Kobo answers sit at the top of the submission; a record made in the app keeps them in `fields`.
    const f = (typeof p.fields === "object" && p.fields ? p.fields : p) as Record<string, unknown>;
    const code_ = r.farmerCode ?? String(p.farmer ?? p.farmerId ?? "");
    const farmer = code_ ? await farmerOf(project.id, code_) : null;
    // The Kobo form answers "<item>_qty" in the package unit ("seed_kg" on the demo form).
    const planned = itemsFor(ctx.setup, farmer?.hectares);
    const items = planned.map((i) => ({ ...i, qty: qtyOf(f[`${i.key}_qty`]) ?? qtyOf(f[`${i.key}_${i.unit}`]) ?? qtyOf(f[`${i.key}_kg`]) ?? i.qty }));
    const g = gate(items, ctx.procs, ctx.given, ctx.setup);
    const photo = r.source === "kobo" ? typeof p.list_photo === "string" && !!p.list_photo : !!p.photo;
    const signed = r.source === "kobo" ? p.signed === "yes" : typeof f.signature === "string" && !!f.signature && f.signature !== "Not confirmed";
    const flags = flagsFor({ farmerId: code_, items, photo, signed, step: r.source === "kobo" ? (farmer?.step ?? "unknown") : null }, ctx.others, planned);
    if (farmer && r.source === "kobo") await db.update(s.evidence).set({ payload: { ...p, _rop_gender: farmer.gender }, updatedAt: new Date() }).where(eq(s.evidence.id, r.id));
    const gender = farmer?.gender ?? (f.gender === "Female" || f.gender === "Male" ? f.gender : null);
    await prepare(code, project, r.id, { farmerId: code_, items, gender, village: farmer?.community ?? (typeof p.village === "string" ? p.village : ""), recordedBy: r.completedBy ?? "KoboCollect", recorderId: r.source === "kobo" ? null : r.completedBy, photo, signed, gate: g, flags }, origin);
    done++;
  }
  return done;
}

/* ---------- 2–3. checks stored, manager told ---------- */

async function prepare(code: string, project: Project, id: string, m: Omit<DistMeta, "hash" | "expires">, origin: string, again?: { by: string; note: string }) {
  const token = randomBytes(24).toString("base64url");
  const meta: DistMeta = { ...m, hash: sha(token), expires: new Date(Date.now() + LINK_DAYS * 864e5).toISOString() };
  const link = `${origin}/approve/${encodeURIComponent(code)}/${id}?t=${token}`;
  const managers = await holders(code, "manager");
  const to = managers.filter((x) => x.email);
  let emailed = false;
  let why: string | undefined;
  if (!to.length) why = managers.length ? "No email address for the project manager in the staff list" : "No project manager on this project";
  else if (!process.env.RESEND_API_KEY) why = "Email is not set up (RESEND_API_KEY)";
  else {
    try {
      const { send } = await import("@/server/notify-store");
      for (const x of to) await send(x.email!, approvalEmail(x.user.name, code, meta, link, again));
      emailed = true;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
  }
  meta.notified = { to: managers.map((x) => x.user.id), at: new Date().toISOString(), emailed, ...(why ? { why } : {}) };
  await db.transaction(async (tx) => {
    await putMeta(tx, project.id, id, meta);
    await tx.insert(s.auditLog).values({ projectId: project.id, entity: "distribution", entityId: id, action: again ? "distribution_resubmitted" : "distribution_recorded", detail: { flags: meta.flags.map((f) => f.id), blocked: !meta.gate.ok, emailed, why: why ?? null, to: meta.notified!.to, ...(again ? { by: again.by, fixed: again.note, items: meta.items } : {}) } });
  });
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function approvalEmail(name: string, code: string, m: DistMeta, link: string, again?: { by: string; note: string }) {
  const what = m.items.map((i) => `${i.qty} ${i.unit} ${i.item}`).join(", ");
  const subject = `${m.gate.ok ? (again ? "Fixed, approval needed" : "Approval needed") : "On hold"}: input distribution in ${m.village || code}${m.flags.length ? ` (${m.flags.length} to check)` : ""}`;
  const fixed = again ? `You sent this back. ${again.by} fixed it and sent it again: ${again.note}` : "";
  const flags = m.flags.length ? m.flags.map((f) => f.text) : ["Nothing flagged."];
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
<p>${esc(name.split(" ")[0])},</p>
<p>${esc(m.farmerId || "A farmer")} in ${esc(m.village || code)} (project ${esc(code)}) received the input package: ${esc(what)}. Recorded by ${esc(m.recordedBy)}.</p>${fixed ? `\n<p>${esc(fixed)}</p>` : ""}
<p style="margin-bottom:4px"><strong>Checks</strong></p><ul style="padding-left:18px;margin-top:0">${m.gate.lines.map((l) => `<li>${esc(l.detail)}</li>`).join("")}</ul>
<p style="margin-bottom:4px"><strong>To look at</strong></p><ul style="padding-left:18px;margin-top:0">${flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<p><a href="${link}" style="background:#1F4E3D;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">${m.gate.ok ? "Review and approve" : "View details"}</a></p>
<p style="color:#888;font-size:12px">The link works once and for ${LINK_DAYS} days. Farmer IDs only: names stay in the app.</p></div>`;
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
  gate: Gate;
  flags: Flag[];
  status: "pending" | "accepted" | "queried";
  notified: DistMeta["notified"] | null;
  decided: DistMeta["decided"] | null;
  history: NonNullable<DistMeta["history"]>;
};

const photoOf = (r: { source: string; payload: unknown }) => {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return r.source === "kobo" ? typeof p.list_photo === "string" && !!p.list_photo : !!p.photo;
};
const signedOf = (r: { source: string; payload: unknown }) => {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const f = (typeof p.fields === "object" && p.fields ? p.fields : p) as Record<string, unknown>;
  return r.source === "kobo" ? p.signed === "yes" : typeof f.signature === "string" && !!f.signature && f.signature !== "Not confirmed";
};

export async function listDistributions(code: string): Promise<DistView[]> {
  const project = await projectByCode(code);
  await processPending(code);
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution")));
  const st = await loadState(project.id);
  const procs = (await db.select().from(s.procurements).where(eq(s.procurements.projectId, project.id))).map((r) => r.data as Procurement);
  const setup = await setupOrEmpty(project);
  // What approved distributions have taken so far, for the checks of the ones still waiting.
  const approved: Given = {};
  for (const r of rows) if (r.reviewStatus === "accepted" && !r.koboRemovedAt) addGiven(approved, st.byId[r.id]?.items ?? itemsFor(setup), setup);
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
        photo: m.photo ?? photoOf(r),
        signed: m.signed ?? signedOf(r),
        // While it waits, the checks are worked out now, as approving will: a goods received note
        // signed since the record was made shows at once. Once decided, they stay as they were then.
        gate: r.reviewStatus === "pending" ? gate(m.items, procs, approved, setup) : m.gate,
        flags: m.flags,
        status: r.reviewStatus,
        notified: m.notified ?? null,
        decided: m.decided ?? null,
        history: m.history ?? [],
      };
    })
    .sort((a, b) => (a.status === b.status ? b.date.localeCompare(a.date) : a.status === "pending" ? -1 : 1));
}

/** Whether a link's token opens this distribution. */
export async function tokenOpens(code: string, id: string, token: string) {
  const project = await projectByCode(code);
  const m = (await loadState(project.id)).byId[id];
  if (!m?.hash || !token || m.expires < new Date().toISOString()) return false;
  const a = Buffer.from(m.hash, "hex");
  const b = Buffer.from(sha(token), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- 4. approved or sent back ---------- */

const isManager = (u: Pick<AppUser, "field">) => u.field.includes("manager");
export const mayApprove = (u: AppUser, code: string) => isManager(u) && onProject(u, code);

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

  const g = gate(m.items, ctx.procs, ctx.given, ctx.setup);
  if (decision === "approved" && !g.ok) throw new HttpError(409, `Not approved: ${g.block}`);

  const finance = decision === "approved" ? (await people()).filter((u) => u.procurement.includes("finance") && onProject(u, code))[0] : undefined;
  // Sent back to the person who recorded it; to the storekeeper or extension agent when that was a phone in the field.
  const fixer = decision === "sent_back" ? fixOwner(m.recorderId ?? row.completedBy, (await people()).filter((u) => onProject(u, code))) : null;
  const now = new Date();
  const day = today();
  const changed: string[] = [];

  await db.transaction(async (tx) => {
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
        else lists.push({ date: day, place, recipients: 1, women, qty, evidence: `ROP Workflow distribution records, approved by ${by.name}`, by: by.id, byName: by.name });
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
      // Field: a Kobo distribution moves the farmer on, as the in-app one already did.
      if (row.source === "kobo" && row.farmerCode) {
        const [item] = await tx.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, project.id), eq(s.fieldItems.itemKey, row.farmerCode))).limit(1);
        const f = item?.data as Farmer | undefined;
        if (item && f?.step === "distribute")
          await tx
            .update(s.fieldItems)
            .set({ data: { ...f, step: "plant", timeline: [...f.timeline, { date: day, who: "manager", what: `Inputs distributed (Kobo), approved by ${by.name}` }] }, updatedAt: now })
            .where(eq(s.fieldItems.id, item.id));
      }
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
    }

    await tx.insert(s.auditLog).values({
      projectId: project.id,
      entity: "distribution",
      entityId: id,
      action: decision === "approved" ? "distribution_approved" : "distribution_sent_back",
      detail: { by: by.id, farmer: row.farmerCode, items: m.items, procurements: changed, flags: m.flags.map((f) => f.id), note: note ?? null, ...(decision === "sent_back" ? { to: fixer } : {}) },
    });
    // The link is used up and the decision kept with the record, in the same step as the decision itself.
    await putMeta(tx, project.id, id, { ...m, gate: g, hash: null, decided: { by: by.id, byName: by.name, at: now.toISOString(), decision, ...(note ? { note: note.trim() } : {}) } });
  });
  return { decision, procurements: changed, fixer };
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
  const items = applyFix(m.items, fix);
  const photo = fix.photo ?? m.photo ?? photoOf(row);
  const signed = fix.signed ?? m.signed ?? signedOf(row);
  const farmer = row.farmerCode ? await farmerOf(project.id, row.farmerCode) : null;
  const flags = flagsFor({ farmerId: row.farmerCode ?? m.farmerId, items, photo, signed, step: row.source === "kobo" ? (farmer?.step ?? "unknown") : null }, ctx.others, itemsFor(ctx.setup, farmer?.hectares));
  const history = [...(m.history ?? []), ...(m.decided ? [{ sentBack: m.decided, fixed: { by: by.id, byName: by.name, at: now.toISOString(), note: note.trim() } }] : [])];
  const { decided: _decided, hash: _hash, expires: _expires, notified: _notified, ...kept } = m;
  void [_decided, _hash, _expires, _notified];
  await prepare(code, project, id, { ...kept, items, photo, signed, gate: gate(items, ctx.procs, ctx.given, ctx.setup), flags, history }, origin, { by: by.name, note: note.trim() });
  return { ok: true as const };
}

/* ---------- readiness "No": a task for the extension agent ---------- */

/** Called inside the readiness decision: a correction task with the deadline, for the extension agent. */
export async function correctionTask(tx: Tx, project: { id: string; organizationId: string | null; code: string }, farmerCode: string, issue: string, deadline: string, evidenceId: string, by: string) {
  const agent = (await people()).find((u) => u.field.includes("extension") && onProject(u, project.code));
  await tx
    .insert(s.workItems)
    .values({
      organizationId: project.organizationId,
      projectId: project.id,
      type: "task",
      title: `Correction for ${farmerCode}: ${issue.slice(0, 120)}`,
      date: deadline,
      assignee: agent?.id ?? null,
      createdBy: by,
      sourceKey: `correction:${evidenceId}`,
      notes: `Readiness check said No. Help the farmer fix this, then record the recheck in KoboCollect by ${deadline}: ${issue}`,
    })
    .onConflictDoNothing();
}
