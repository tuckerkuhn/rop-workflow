import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { today } from "@/lib/clock";
import type { AppUser } from "@/lib/demo";
import { flagsFor, gate, inProcUnit, plannedItems, suppliersOf, toKg, type DistItem, type Flag, type Gate, type PackageKey } from "@/lib/distribution";
import type { Farmer } from "@/lib/field";
import type { Procurement } from "@/lib/procurement";
import type { Submission } from "@/lib/project";
import { demoMode, onProject, people, toAppUser } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { loadProjectState, saveProjectState } from "@/server/project-state";

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
 *    a task to fix it.
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
  notified?: { to: string[]; at: string; emailed: boolean; why?: string };
  decided?: { by: string; byName: string; at: string; decision: "approved" | "sent_back"; note?: string };
};
type State = { byId: Record<string, DistMeta> };

const loadState = async (projectId: string) => loadProjectState<State>(projectId, KEY, { byId: {} });
const saveState = (projectId: string, st: State) => saveProjectState(projectId, KEY, st);
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

type Project = Awaited<ReturnType<typeof projectByCode>>;

/** Everything the gate needs: the purchases, and what each earlier distribution took, in kg. */
async function context(project: Project, opts: { excluding?: string; countPending: boolean }) {
  const procs = (await db.select().from(s.procurements).where(eq(s.procurements.projectId, project.id))).map((r) => r.data as Procurement);
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution")));
  const st = await loadState(project.id);
  const givenKg: Partial<Record<PackageKey, number>> = {};
  const others: string[] = [];
  for (const r of rows) {
    if (r.id === opts.excluding || r.koboRemovedAt || r.reviewStatus === "queried") continue;
    if (r.farmerCode) others.push(r.farmerCode);
    if (r.reviewStatus === "pending" && !opts.countPending) continue;
    for (const it of st.byId[r.id]?.items ?? []) givenKg[it.key] = (givenKg[it.key] ?? 0) + (toKg(it.qty, it.unit) ?? it.qty);
  }
  return { procs, givenKg, others, st };
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
  const items = plannedItems();
  const ctx = await context(project, { countPending: true });
  const g = gate(items, ctx.procs, ctx.givenKg);
  if (!g.ok) throw new HttpError(409, `${farmer.id}'s input package can't be recorded as handed out yet. ${g.block}`);
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
  const flags = flagsFor({ farmerId: farmer.id, items, photo, signed, step: null }, ctx.others);
  await prepare(code, project, row.id, { farmerId: farmer.id, items, gender: farmer.gender, village: farmer.community, recordedBy: user.name, gate: g, flags }, origin);
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
    const items = plannedItems().map((i) => ({ ...i, qty: qtyOf(f[`${i.key}_kg`]) ?? i.qty }));
    const g = gate(items, ctx.procs, ctx.givenKg);
    const photo = r.source === "kobo" ? typeof p.list_photo === "string" && !!p.list_photo : !!p.photo;
    const signed = r.source === "kobo" ? p.signed === "yes" : typeof f.signature === "string" && !!f.signature && f.signature !== "Not confirmed";
    const flags = flagsFor({ farmerId: code_, items, photo, signed, step: r.source === "kobo" ? (farmer?.step ?? "unknown") : null }, ctx.others);
    if (farmer && r.source === "kobo") await db.update(s.evidence).set({ payload: { ...p, _rop_gender: farmer.gender }, updatedAt: new Date() }).where(eq(s.evidence.id, r.id));
    const gender = farmer?.gender ?? (f.gender === "Female" || f.gender === "Male" ? f.gender : null);
    await prepare(code, project, r.id, { farmerId: code_, items, gender, village: farmer?.community ?? (typeof p.village === "string" ? p.village : ""), recordedBy: r.completedBy ?? "KoboCollect", gate: g, flags }, origin);
    done++;
  }
  return done;
}

/* ---------- 2–3. checks stored, manager told ---------- */

async function prepare(code: string, project: Project, id: string, m: Omit<DistMeta, "hash" | "expires">, origin: string) {
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
      for (const x of to) await send(x.email!, approvalEmail(x.user.name, code, meta, link));
      emailed = true;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
  }
  meta.notified = { to: managers.map((x) => x.user.id), at: new Date().toISOString(), emailed, ...(why ? { why } : {}) };
  const st = await loadState(project.id);
  st.byId[id] = meta;
  await saveState(project.id, st);
  await db.insert(s.auditLog).values({ projectId: project.id, entity: "distribution", entityId: id, action: "distribution_recorded", detail: { flags: meta.flags.map((f) => f.id), blocked: !meta.gate.ok, emailed, why: why ?? null, to: meta.notified.to } });
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function approvalEmail(name: string, code: string, m: DistMeta, link: string) {
  const what = m.items.map((i) => `${i.qty} ${i.unit} ${i.item}`).join(", ");
  const subject = `${m.gate.ok ? "Approval needed" : "On hold"}: input distribution in ${m.village || code}${m.flags.length ? ` (${m.flags.length} to check)` : ""}`;
  const flags = m.flags.length ? m.flags.map((f) => f.text) : ["Nothing flagged."];
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
<p>${esc(name.split(" ")[0])},</p>
<p>${esc(m.farmerId || "A farmer")} in ${esc(m.village || code)} (project ${esc(code)}) received the input package: ${esc(what)}. Recorded by ${esc(m.recordedBy)}.</p>
<p style="margin-bottom:4px"><strong>Checks</strong></p><ul style="padding-left:18px;margin-top:0">${m.gate.lines.map((l) => `<li>${esc(l.detail)}</li>`).join("")}</ul>
<p style="margin-bottom:4px"><strong>To look at</strong></p><ul style="padding-left:18px;margin-top:0">${flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<p><a href="${link}" style="background:#1F4E3D;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">${m.gate.ok ? "Review and approve" : "View details"}</a></p>
<p style="color:#888;font-size:12px">The link works once and for ${LINK_DAYS} days. Farmer IDs only: names stay in the app.</p></div>`;
  const text = [`${name.split(" ")[0]},`, "", `${m.farmerId || "A farmer"} in ${m.village || code} (project ${code}) received the input package: ${what}. Recorded by ${m.recordedBy}.`, "", "Checks:", ...m.gate.lines.map((l) => `- ${l.detail}`), "", "To look at:", ...flags.map((f) => `- ${f}`), "", link].join("\n");
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
  gate: Gate;
  flags: Flag[];
  status: "pending" | "accepted" | "queried";
  notified: DistMeta["notified"] | null;
  decided: DistMeta["decided"] | null;
};

export async function listDistributions(code: string): Promise<DistView[]> {
  const project = await projectByCode(code);
  await processPending(code);
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "distribution")));
  const st = await loadState(project.id);
  return rows
    .filter((r) => st.byId[r.id] && !r.koboRemovedAt)
    .map((r) => {
      const m = st.byId[r.id];
      const p = (r.payload ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        farmerId: r.farmerCode ?? "",
        village: m.village,
        date: (r.completedAt ?? r.createdAt).toISOString().slice(0, 10),
        source: r.source === "kobo" ? ("kobo" as const) : ("app" as const),
        recordedBy: m.recordedBy,
        items: m.items,
        gender: m.gender,
        photo: r.source === "kobo" ? typeof p.list_photo === "string" && !!p.list_photo : !!(p as { photo?: boolean }).photo,
        gate: m.gate,
        flags: m.flags,
        status: r.reviewStatus,
        notified: m.notified ?? null,
        decided: m.decided ?? null,
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

  const g = gate(m.items, ctx.procs, ctx.givenKg);
  if (decision === "approved" && !g.ok) throw new HttpError(409, `Not approved: ${g.block}`);

  const finance = decision === "approved" ? (await people()).filter((u) => u.procurement.includes("finance") && onProject(u, code))[0] : undefined;
  const store = decision === "sent_back" ? (await holders(code, "store"))[0]?.user : undefined;
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
        const supplier = suppliersOf(it.key, rows.map((r) => r.data as Procurement)).find((p) => g.lines.find((l) => l.key === it.key)?.procurements.includes(p.id));
        const r = supplier && rows.find((x) => x.procKey === supplier.id);
        if (!r || !supplier) continue;
        const p = r.data as Procurement;
        const d = p.distribution ?? { forParticipants: true, lists: [], inStock: 0, checks: [] };
        const qty = inProcUnit(toKg(it.qty, it.unit) ?? it.qty, p);
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
          assignee: store?.id ?? null,
          createdBy: by.id,
          sourceKey: `dist-fix:${id}`,
          notes: `Sent back by ${by.name}: ${note!.trim()}`,
        })
        .onConflictDoNothing();
    }

    await tx.insert(s.auditLog).values({
      projectId: project.id,
      entity: "distribution",
      entityId: id,
      action: decision === "approved" ? "distribution_approved" : "distribution_sent_back",
      detail: { by: by.id, farmer: row.farmerCode, items: m.items, procurements: changed, flags: m.flags.map((f) => f.id), note: note ?? null },
    });
  });

  const st = await loadState(project.id);
  st.byId[id] = { ...st.byId[id], gate: g, hash: null, decided: { by: by.id, byName: by.name, at: now.toISOString(), decision, ...(note ? { note } : {}) } };
  await saveState(project.id, st);
  return { decision, procurements: changed };
}

/* ---------- readiness "No": a task for the extension agent ---------- */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
