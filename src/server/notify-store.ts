import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { registerAuthority } from "@/lib/authority";
import type { AppUser } from "@/lib/demo";
import { DONE, ownerOf, procRolesFor, setProcurementSet } from "@/lib/procurement";
import { loadActivities } from "@/server/activities-store";
import { onProject, toAppUser } from "@/server/auth";
import { loadHome } from "@/server/home-store";
import { loadProgressSummary } from "@/server/progress-summary-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { loadHr } from "@/server/hr-store";
import { loadProcurements } from "@/server/procurement-store";
import { listProjects } from "@/server/project-store";
import { listWorkItems } from "@/server/work-store";

/**
 * The daily email: what is waiting for each person across their projects. It leads with impact
 * (targets slipping, activities they own that are late or not started, results waiting to count)
 * and puts workflow (sign-offs, imports, procurement, tasks) after it, briefly. It is sent
 * only when something new has come in since the last email, with a Monday reminder of anything
 * still waiting. People turn it off in Settings. Mail goes through Resend (RESEND_API_KEY).
 */

export type DigestItem = { key: string; project: string; text: string; href: string; urgent: boolean; kind: "impact" | "workflow"; why?: string };
type NotifyState = { prefs: Record<string, { off?: boolean }>; sent: Record<string, { at: string; keys: string[] }> };
const KEY = "notify";
const EMPTY: NotifyState = { prefs: {}, sent: {} };

async function loadState(orgId: string): Promise<NotifyState> {
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY)))
    .limit(1);
  return { ...EMPTY, ...((row?.data as Partial<NotifyState>) ?? {}) };
}
async function saveState(orgId: string, data: NotifyState) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

export async function getPrefs(orgId: string, personId: string) {
  const st = await loadState(orgId);
  return { off: !!st.prefs[personId]?.off, last: st.sent[personId]?.at ?? null };
}
export async function setPrefs(orgId: string, personId: string, off: boolean) {
  const st = await loadState(orgId);
  await saveState(orgId, { ...st, prefs: { ...st.prefs, [personId]: { off } } });
}

/** Home's actions that are about delivering results; the rest are workflow. */
const IMPACT_ACTIONS = new Set(["accept", "queried"]);

/**
 * Everything waiting for one person today, impact first: the results and activities the
 * project exists to deliver. Workflow steps (procurement, finance imports, sign-offs, tasks)
 * follow, procurement as one line per project rather than a list.
 */
export async function itemsFor(u: AppUser, today: string): Promise<DigestItem[]> {
  // The demo project's fictional records never go out by email.
  const projects = (await listProjects()).filter((p) => p.code !== DEMO_PROJECT && onProject(u, p.code) && p.stage !== "Develop");
  const out: DigestItem[] = [];
  for (const p of projects) {
    const short = p.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? p.code;
    const home = await loadHome(p.code, u).catch(() => null);
    const lead = home?.lenses.includes("lead");

    // Impact: targets slipping (for those who lead the project), the activities this person owns,
    // and the evidence that makes results count.
    if (lead) {
      const sum = await loadProgressSummary(p.code, u).catch(() => null);
      for (const c of sum?.concerns.filter((x) => x.key.startsWith("late-") || x.key === "due" || x.key === "acts-owner") ?? [])
        out.push({ key: `${p.code}:impact:${c.key}:${c.text}`, project: short, text: c.text, why: c.why, href: c.href, urgent: c.level === "critical", kind: "impact" });
    }
    if (u.kind === "employee") {
      const acts = await loadActivities(p.code, u).catch(() => null);
      for (const r of acts?.rows.filter((x) => x.mine && x.timing === "late") ?? [])
        out.push({ key: `${p.code}:act:${r.code}`, project: short, text: `${r.code} ${r.title} is past its planned quarter`, why: "Mark it done, or say what is in the way so it can be re-planned.", href: "/work/activities", urgent: true, kind: "impact" });
      for (const r of acts?.rows.filter((x) => x.mine && x.timing === "due_now" && x.status === "not_started") ?? [])
        out.push({ key: `${p.code}:actdue:${r.code}`, project: short, text: `${r.code} ${r.title} is planned for this quarter and not started`, why: "Start it, or flag what is holding it up.", href: "/work/activities", urgent: false, kind: "impact" });
    }
    for (const a of (home?.actions ?? []).filter((x) => IMPACT_ACTIONS.has(x.key))) out.push({ key: `${p.code}:${a.key}:${a.text}`, project: short, text: a.text, href: a.href, urgent: a.urgent, kind: "impact" });

    // Workflow: needed, but in service of the above.
    for (const a of (home?.actions ?? []).filter((x) => !IMPACT_ACTIONS.has(x.key))) out.push({ key: `${p.code}:${a.key}:${a.text}`, project: short, text: a.text, href: a.href, urgent: a.urgent, kind: "workflow" });
    if (u.procurementAccess === "edit") {
      const procs = await loadProcurements(p.code).catch(() => []);
      setProcurementSet(procs);
      const mine = procRolesFor(u);
      const waiting = procs.filter((x) => x.step !== DONE && ownerOf(x) && mine.includes(ownerOf(x)!));
      if (waiting.length)
        out.push({
          key: `${p.code}:proc:${waiting.map((q) => `${q.id}@${q.step}`).sort().join(",")}`,
          project: short,
          text: `${waiting.length} procurement ${waiting.length === 1 ? "step is" : "steps are"} waiting for you`,
          href: "/work?source=procurement",
          urgent: false,
          kind: "workflow",
        });
    }
    if (u.kind === "employee") {
      const work = await listWorkItems(p.code).catch(() => ({ items: [] }));
      const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
      for (const t of work.items.filter((w) => w.type === "task" && !w.doneAt && w.assignee === u.id && w.date && w.date <= soon))
        out.push({ key: `${p.code}:task:${t.id}`, project: short, text: `${t.title}${t.date! < today ? ` (was due ${t.date})` : ` (due ${t.date})`}`, href: "/work", urgent: t.date! < today, kind: "workflow" });
    }
  }
  return out;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function digestEmail(name: string, fresh: DigestItem[], waiting: DigestItem[], origin: string) {
  const all = [...fresh.map((i) => ({ ...i, isNew: true })), ...waiting.map((i) => ({ ...i, isNew: false }))];
  const impact = all.filter((i) => i.kind === "impact");
  const workflow = all.filter((i) => i.kind === "workflow");
  const tag = (i: (typeof all)[number]) => [i.project, i.isNew ? "new" : "", i.urgent ? "now" : ""].filter(Boolean).join(" · ");
  const li = (i: (typeof all)[number]) =>
    `<li style="margin:0 0 10px"><a href="${origin}${i.href}" style="color:#1F4E3D;font-weight:600">${esc(i.text)}</a> <span style="color:#777;font-size:13px">${esc(tag(i))}</span>${i.why ? `<br><span style="color:#555;font-size:13px">${esc(i.why)}</span>` : ""}</li>`;
  const small = (i: (typeof all)[number]) => `<li style="margin:0 0 4px;font-size:14px"><a href="${origin}${i.href}" style="color:#1F4E3D">${esc(i.text)}</a> <span style="color:#777;font-size:12px">${esc(tag(i))}</span></li>`;
  const subject = impact.length
    ? `${impact.length} ${impact.length === 1 ? "thing" : "things"} affecting results need you${fresh.length ? "" : " (reminder)"}`
    : `${workflow.length} workflow ${workflow.length === 1 ? "step is" : "steps are"} waiting for you${fresh.length ? "" : " (reminder)"}`;
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
<p>Good morning ${esc(name.split(" ")[0])},</p>
${impact.length ? `<p style="margin-bottom:6px"><strong>Results and the work that delivers them</strong></p><ul style="padding-left:18px;margin-top:0">${impact.map(li).join("")}</ul>` : `<p>Nothing is slipping on results or activities you own.</p>`}
${workflow.length ? `<p style="margin-bottom:6px;color:#555"><strong>Also waiting for you</strong></p><ul style="padding-left:18px;margin-top:0">${workflow.map(small).join("")}</ul>` : ""}
<p><a href="${origin}/home" style="color:#1F4E3D">Open ROP Workflow</a></p>
<p style="color:#888;font-size:12px">You get this when something new needs you, and on Mondays when anything is still waiting. Turn it off in Settings.</p></div>`;
  const line = (i: (typeof all)[number]) => `- ${i.text} (${tag(i)}) ${origin}${i.href}`;
  const text = [`Good morning ${name.split(" ")[0]},`, "", impact.length ? "Results and the work that delivers them:" : "Nothing is slipping on results or activities you own.", ...impact.map(line), ...(workflow.length ? ["", "Also waiting for you:", ...workflow.map(line)] : []), "", `${origin}/home`].join("\n");
  return { subject, html, text };
}

async function send(to: string, mail: { subject: string; html: string; text: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM || "ROP Workflow <workflow@mail.rootsofpeace.org>", to: [to], ...mail }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Runs the digest for everyone. `dryRun` returns what would be sent without sending or
 * remembering anything.
 */
export async function runDigest(origin: string, dryRun = false) {
  const today = new Date().toISOString().slice(0, 10);
  const monday = new Date().getUTCDay() === 1;
  registerAuthority((await loadHr().catch(() => null))?.state.rules?.holders ?? {});
  const staff = (await db.select().from(s.staff).where(eq(s.staff.active, true))).filter((r) => r.email && r.personId && r.profile);
  const byOrg = new Map<string, NotifyState>();
  const report: { person: string; fresh: number; waiting: number; sent: boolean; why?: string }[] = [];
  for (const row of staff) {
    const st = byOrg.get(row.organizationId) ?? (await loadState(row.organizationId));
    byOrg.set(row.organizationId, st);
    const u = toAppUser(row);
    if (st.prefs[u.id]?.off) {
      report.push({ person: u.id, fresh: 0, waiting: 0, sent: false, why: "turned off" });
      continue;
    }
    const items = await itemsFor(u, today);
    const before = new Set(st.sent[u.id]?.keys ?? []);
    const fresh = items.filter((i) => !before.has(i.key));
    const waiting = items.filter((i) => before.has(i.key));
    const go = fresh.length > 0 || (monday && waiting.length > 0);
    if (go && !dryRun) {
      try {
        await send(row.email!, digestEmail(u.name, fresh, waiting, origin));
      } catch (e) {
        report.push({ person: u.id, fresh: fresh.length, waiting: waiting.length, sent: false, why: e instanceof Error ? e.message : String(e) });
        continue;
      }
    }
    // Remember today's list either way, so an item is new only once.
    if (!dryRun) st.sent[u.id] = { at: go ? today : (st.sent[u.id]?.at ?? ""), keys: items.map((i) => i.key) };
    report.push({ person: u.id, fresh: fresh.length, waiting: waiting.length, sent: go && !dryRun, ...(go ? {} : { why: "nothing new" }) });
  }
  if (!dryRun) for (const [org, st] of byOrg) await saveState(org, st);
  return { date: today, people: report };
}
