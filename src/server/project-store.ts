import { and, asc, eq, notInArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { IndicatorInput, ProjectDesign, ProjectSummary } from "@/lib/project-setup";

/** Projects and their design (goal, dates, indicators) in Postgres, written by project setup. */

const summary = (p: typeof s.projects.$inferSelect): ProjectSummary => ({
  code: p.code ?? p.id,
  name: p.name,
  country: p.country,
  crop: p.crop,
  goal: p.goal,
  startDate: p.startDate,
  endDate: p.endDate,
});

export async function listProjects() {
  return (await db.select().from(s.projects).orderBy(asc(s.projects.createdAt))).map(summary);
}

export async function projectDesign(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) return null;
  const inds = await db.select().from(s.indicators).where(eq(s.indicators.projectId, p.id)).orderBy(asc(s.indicators.position));
  return {
    ...summary(p),
    indicators: inds.map((i) => ({ code: i.code, name: i.name, unit: i.unit, target: Number(i.target), level: i.level, frequency: i.frequency, forecast: i.forecast })),
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

/** Inserts new indicators and updates existing ones by code. Ones left out are removed, with their mappings. */
async function syncIndicators(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string, list: IndicatorInput[]) {
  const existing = await tx.select().from(s.indicators).where(eq(s.indicators.projectId, projectId));
  const keep = list.filter((i) => i.code && existing.some((e) => e.code === i.code)).map((i) => i.code!);
  const mine = eq(s.indicators.projectId, projectId);
  await tx.delete(s.indicators).where(keep.length ? and(mine, notInArray(s.indicators.code, keep)) : mine);
  let next = Math.max(0, ...existing.map((e) => Number(e.code.replace(/^IND-/, "")) || 0)) + 1;
  for (const [position, i] of list.entries()) {
    const fields = { name: i.name, unit: i.unit, target: String(i.target), forecast: i.forecast ?? {}, level: i.level, frequency: i.frequency, position, updatedAt: new Date() };
    if (i.code && keep.includes(i.code)) await tx.update(s.indicators).set(fields).where(and(mine, eq(s.indicators.code, i.code)));
    // New indicators count from a KoboToolbox question once one is mapped.
    else await tx.insert(s.indicators).values({ ...fields, projectId, code: `IND-${next++}`, source: "kobo" });
  }
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
  return true;
}
