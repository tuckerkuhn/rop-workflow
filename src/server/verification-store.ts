import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { clampRate, doneRate, drawMonth, EMPTY_VERIFICATION, VERIFICATION_KEY, type MonthSample, type VerificationState, type VisitResult } from "@/lib/verification";
import { realToday } from "@/lib/clock";
import { onProject, people } from "@/server/auth";
import { loadField, projectByCode, setupFor } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { loadProjectState, updateProjectState } from "@/server/project-state";

/**
 * The monthly verification sample (lib/verification, MF-10): drawn once a month by MEL or the
 * project manager, each visit assigned to someone who did not collect that farmer's records, and
 * the share visited tracked month by month.
 */

/** Who checks field work: MEL, the project manager and plan approvers on this project. */
const isChecker = (u: AppUser, code: string) => u.kind === "employee" && onProject(u, code) && (u.project.includes("mel-owner") || u.field.includes("mel") || u.field.includes("manager"));
export const mayDraw = (u: AppUser, code: string) => isChecker(u, code);

export async function verificationView(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const st = await loadProjectState<VerificationState>(project.id, VERIFICATION_KEY, EMPTY_VERIFICATION);
  const month = realToday().slice(0, 7);
  const team = await people();
  const name = (id: string | null) => (id ? (team.find((p) => p.id === id)?.name ?? id) : null);
  const months = Object.values(st.months)
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((m) => ({ ...m, done: doneRate(m), visits: m.visits.map((v) => ({ ...v, collectorName: name(v.collector), assigneeName: name(v.assignee), mine: v.assignee === u.id })) }));
  return { month, drawn: !!st.months[month], may: { draw: mayDraw(u, code) }, rate: clampRate((await setupFor(code))?.verifyRate), months };
}

/** Draws this month's sample, once. Drawing again the same month changes nothing. */
export async function drawThisMonth(code: string, u: AppUser) {
  if (!mayDraw(u, code)) throw new HttpError(403, "MEL or the project manager draws the verification sample.");
  const project = await projectByCode(code);
  const month = realToday().slice(0, 7);
  const [field, rows, team, setup] = await Promise.all([
    loadField(code),
    db.select({ farmer: s.evidence.farmerCode, by: s.evidence.completedBy }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), isNotNull(s.evidence.farmerCode))),
    people(),
    setupFor(code),
  ]);
  const farmers = field.items
    .filter((i): i is Farmer => i.kind === "farmer" && i.step !== "removed")
    .map((f) => ({ id: f.id, collectors: [...new Set(rows.filter((r) => r.farmer === f.id && r.by).map((r) => r.by as string))] }));
  if (!farmers.length) throw new HttpError(409, "No farmers on this project yet: nothing to draw.");
  const checkers = team.filter((p) => isChecker(p, code)).map((p) => p.id);
  const rate = clampRate(setup?.verifyRate);
  return updateProjectState<VerificationState, MonthSample>(project.id, VERIFICATION_KEY, EMPTY_VERIFICATION, async (st) => {
    if (st.months[month]) return { data: null, result: st.months[month] };
    const sample: MonthSample = { month, rate, drawnAt: new Date().toISOString(), drawnBy: u.id, visits: drawMonth(code, month, farmers, checkers, rate) };
    return { data: { months: { ...st.months, [month]: sample } }, result: sample };
  });
}

/** Records a verification visit: by the person it is assigned to, or MEL when nobody could be. */
export async function recordVisit(code: string, month: string, farmer: string, result: VisitResult, note: string, u: AppUser) {
  const project = await projectByCode(code);
  return updateProjectState<VerificationState, MonthSample>(project.id, VERIFICATION_KEY, EMPTY_VERIFICATION, async (st) => {
    const m = st.months[month];
    const v = m?.visits.find((x) => x.farmer === farmer);
    if (!m || !v) throw new HttpError(404, "That farmer is not in this month's sample.");
    if (v.collector === u.id) throw new HttpError(403, "You collected this farmer's records, so someone else verifies them.");
    if (!(v.assignee === u.id || (!v.assignee && isChecker(u, code)))) throw new HttpError(403, "This visit is assigned to someone else.");
    if (v.done) throw new HttpError(409, "This visit is already recorded.");
    const next: MonthSample = { ...m, visits: m.visits.map((x) => (x.farmer === farmer ? { ...x, done: { by: u.id, byName: u.name, at: realToday(), result, note } } : x)) };
    return { data: { months: { ...st.months, [month]: next } }, result: next };
  });
}
