import { and, asc, eq, notInArray } from "drizzle-orm";
import { KOBO_APPROVAL_KEY, NEW_PROJECT_KOBO_APPROVAL } from "@/lib/kobo-approval";
import { db, schema as s } from "@/db";
import { THEMES, type ImpactTheme } from "@/lib/indicator-library";
import type { IndicatorInput, ProjectDesign, ProjectKind, ProjectSummary } from "@/lib/project-setup";
import { CROP_PLAN_KEY, type CropPlan } from "@/lib/crops";
import { EMPTY_FRAMEWORK, FRAMEWORK_KEY, type Framework } from "@/lib/framework";
import { isMeasure, MEASURES_KEY, type MeasuresDoc } from "@/lib/measure";
import { frameworkFromIndicators, INDICATOR_DOCS_KEY, type IndicatorDocs } from "@/lib/setup-design";
import { loadMeasures } from "@/server/measures";
import { loadProjectState, saveProjectState } from "@/server/project-state";

/** Projects and their design (goal, dates, indicators) in Postgres, written by project setup. */

/** A project set aside while the app is built: hidden everywhere, its data kept (npm run park). */
export const PARKED = "parked";

const summary = (p: typeof s.projects.$inferSelect): ProjectSummary => ({
  code: p.code ?? p.id,
  name: p.name,
  country: p.country,
  crop: p.crop,
  goal: p.goal,
  startDate: p.startDate,
  endDate: p.endDate,
  stage: p.stage,
  kind: (["sample", "sandbox"].includes(p.kind) ? p.kind : "real") as ProjectKind,
});

/**
 * The projects there are. Real projects only, unless `all`: the sample and the sandboxes hold
 * fictional data, so portfolio totals, track record and notifications never count them. The
 * project picker asks for all. A parked project (kind "parked") is never listed: it is set aside
 * with its data kept until it is brought back (npm run park).
 */
export async function listProjects(opts: { all?: boolean } = {}) {
  const all = (await db.select().from(s.projects).orderBy(asc(s.projects.createdAt))).filter((p) => p.kind !== PARKED).map(summary);
  return opts.all ? all : all.filter((p) => p.kind === "real");
}

export async function projectDesign(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) return null;
  const inds = await db.select().from(s.indicators).where(eq(s.indicators.projectId, p.id)).orderBy(asc(s.indicators.position));
  const cropPlan = await loadProjectState<CropPlan | null>(p.id, CROP_PLAN_KEY, null);
  const [measures, docs] = await Promise.all([loadMeasures(p.id), loadProjectState<IndicatorDocs>(p.id, INDICATOR_DOCS_KEY, {})]);
  return {
    ...summary(p),
    ...(cropPlan ? { cropPlan } : {}),
    indicators: inds.map((i) => {
      const doc = docs[i.code] ?? {};
      const m = measures[i.code];
      return {
        code: i.code,
        ...(i.donorCode ? { donorCode: i.donorCode } : {}),
        name: i.name,
        unit: i.unit,
        target: Number(i.target),
        level: i.level,
        frequency: i.frequency,
        forecast: i.forecast,
        theme: (THEMES as readonly string[]).includes(i.theme ?? "") ? (i.theme as ImpactTheme) : null,
        // What the documents said, so setup shows it again and a person can correct it.
        baseline: i.baseline === null ? null : Number(i.baseline),
        baselineYear: doc.baselineYear ?? null,
        disaggregation: i.disaggregation ?? [],
        verification: i.verification,
        result: i.result,
        frequencyAsWritten: doc.frequencyAsWritten ?? null,
        docSource: doc.source ?? null,
        // Only a measure that was saved: a default stays a default.
        ...(isMeasure(m) ? { measure: m } : {}),
      };
    }),
  };
}

/** "Afghan Table Grapes" starting 2027 → "ATG-2027"; a number is added if the code is taken. */
async function newCode(name: string, start: string) {
  const letters = name
    .split(/\s+/)
    .map((w) => w.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4) || "P";
  const stem = `${letters}-${start.slice(0, 4)}`;
  const taken = new Set((await db.select({ code: s.projects.code }).from(s.projects)).map((r) => r.code));
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One project_state document inside the transaction: read, changed, written back when it changed. */
async function changeState<T extends object>(tx: Tx, projectId: string, key: string, change: (doc: T) => T | null) {
  const where = and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, key));
  const [row] = await tx.select({ data: s.projectState.data }).from(s.projectState).where(where).for("update");
  const next = change(((row?.data as T | undefined) ?? {}) as T);
  if (!next) return;
  if (row) await tx.update(s.projectState).set({ data: next, updatedAt: new Date() }).where(where);
  else await tx.insert(s.projectState).values({ projectId, key, data: next }).onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: next, updatedAt: new Date() } });
}

/**
 * Inserts new indicators and updates existing ones by code. Ones left out are removed, with their
 * mappings. What the documents said about each (lib/setup-design) lands in its columns (baseline,
 * disaggregation, verification, result), in project_state where no column holds it (baseline year,
 * frequency as written, source: "indicator_documents"; measure: "measures"); its result
 * statement goes to the results framework where that has no wording yet. A field left out keeps what is stored.
 */
async function syncIndicators(tx: Tx, projectId: string, list: IndicatorInput[]) {
  const existing = await tx.select().from(s.indicators).where(eq(s.indicators.projectId, projectId));
  const keep = list.filter((i) => i.code && existing.some((e) => e.code === i.code)).map((i) => i.code!);
  const mine = eq(s.indicators.projectId, projectId);
  await tx.delete(s.indicators).where(keep.length ? and(mine, notInArray(s.indicators.code, keep)) : mine);
  let next = Math.max(0, ...existing.map((e) => Number(e.code.replace(/^IND-/, "")) || 0)) + 1;
  /** Each indicator's code, in the list's order, once saved. */
  const codes: string[] = [];
  for (const [position, i] of list.entries()) {
    // A theme left out (older clients) keeps what is stored; null clears it.
    const fields = {
      name: i.name,
      unit: i.unit,
      target: String(i.target),
      forecast: i.forecast ?? {},
      level: i.level,
      frequency: i.frequency,
      position,
      updatedAt: new Date(),
      ...(i.theme !== undefined ? { theme: i.theme } : {}),
      ...(i.donorCode !== undefined ? { donorCode: i.donorCode || null } : {}),
      ...(i.baseline !== undefined ? { baseline: i.baseline === null ? null : String(Math.round(i.baseline * 100) / 100) } : {}),
      ...(i.disaggregation !== undefined ? { disaggregation: i.disaggregation.length ? i.disaggregation : null } : {}),
      ...(i.verification !== undefined ? { verification: i.verification || null } : {}),
      ...(i.result !== undefined ? { result: i.result || null } : {}),
    };
    let code = i.code;
    if (code && keep.includes(code)) await tx.update(s.indicators).set(fields).where(and(mine, eq(s.indicators.code, code)));
    // New indicators take results with proof, checked by MEL; a KoboToolbox question mapped to one
    // turns its submissions into those results (server/kobo-results.ts).
    else await tx.insert(s.indicators).values({ ...fields, projectId, code: (code = `IND-${next++}`), source: "results" });
    codes.push(code);
  }
  const touched = (k: keyof IndicatorInput) => list.some((i) => i[k] !== undefined);
  if (touched("baselineYear") || touched("frequencyAsWritten") || touched("docSource"))
    await changeState<IndicatorDocs>(tx, projectId, INDICATOR_DOCS_KEY, (doc) => {
      const next: IndicatorDocs = Object.fromEntries(Object.entries(doc).filter(([c]) => codes.includes(c)));
      list.forEach((i, n) => {
        const was = next[codes[n]] ?? {};
        const now = {
          baselineYear: i.baselineYear !== undefined ? i.baselineYear : (was.baselineYear ?? null),
          frequencyAsWritten: i.frequencyAsWritten !== undefined ? i.frequencyAsWritten || null : (was.frequencyAsWritten ?? null),
          source: i.docSource !== undefined ? i.docSource || null : (was.source ?? null),
        };
        if (now.baselineYear !== null || now.frequencyAsWritten || now.source) next[codes[n]] = now;
        else delete next[codes[n]];
      });
      return next;
    });
  // A removed target's measure goes with it, and a new target starts with only its own: a code
  // freed by a deletion and given out again must not inherit the old target's survey setting.
  const fresh = new Set(codes.filter((c) => !keep.includes(c)));
  if (touched("measure") || fresh.size || existing.length > keep.length)
    await changeState<MeasuresDoc>(tx, projectId, MEASURES_KEY, (doc) => {
      const next: MeasuresDoc = Object.fromEntries(Object.entries(doc).filter(([c]) => codes.includes(c) && !fresh.has(c)));
      list.forEach((i, n) => {
        if (i.measure) next[codes[n]] = i.measure;
      });
      return next;
    });
  if (touched("result"))
    await changeState<Framework>(tx, projectId, FRAMEWORK_KEY, (doc) => frameworkFromIndicators({ ...EMPTY_FRAMEWORK, ...doc }, list, new Date().toISOString().slice(0, 10)));
}

export async function createProject(design: ProjectDesign) {
  // Single organization in the pilot: new projects join it.
  const [org] = await db.select().from(s.organizations).orderBy(asc(s.organizations.createdAt)).limit(1);
  if (!org) throw new Error("No organization in the database. Run npm run db:seed.");
  const code = await newCode(design.name, design.startDate);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(s.projects)
      .values({ organizationId: org.id, code, name: design.name, country: design.country, crop: design.crop || null, goal: design.goal || null, startDate: design.startDate, endDate: design.endDate })
      .returning();
    await syncIndicators(tx, p.id, design.indicators);
    for (const name of design.donors ?? []) await tx.insert(s.donors).values({ projectId: p.id, organizationId: org.id, name });
    // A new project starts with one named person approving KoboCollect data, still to be chosen in Set up.
    await tx.insert(s.projectState).values({ projectId: p.id, key: KOBO_APPROVAL_KEY, data: NEW_PROJECT_KOBO_APPROVAL });
    if (design.cropPlan) await tx.insert(s.projectState).values({ projectId: p.id, key: CROP_PLAN_KEY, data: design.cropPlan });
    return code;
  });
}

export async function updateProject(code: string, design: ProjectDesign) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(s.projects)
      .set({ name: design.name, country: design.country, crop: design.crop || null, goal: design.goal || null, startDate: design.startDate, endDate: design.endDate, updatedAt: new Date() })
      .where(eq(s.projects.id, p.id));
    await syncIndicators(tx, p.id, design.indicators);
  });
  // Kept as it was when the form sends none (an older page); replaced when it sends one.
  if (design.cropPlan) await saveProjectState(p.id, CROP_PLAN_KEY, design.cropPlan);
  return true;
}
