import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { KOBO_APPROVAL_KEY, type KoboApproval } from "@/lib/kobo-approval";
import { FIELD_SETUP_KEY, type FieldSetup } from "@/lib/package";
import { approvalForCopy, nextSteps, setupForCopy, type CopyResult } from "@/lib/project-template";
import { logAudit } from "@/server/audit";
import { onProject, people } from "@/server/auth";
import { projectByCode, projectsWithField, setupOf } from "@/server/field-store";
import { HttpError } from "@/server/guard";

/** The projects whose setup this person can start another project from: those with an input package that they work on. */
export async function templateSources(u: AppUser, except: string): Promise<{ code: string; name: string }[]> {
  const withField = await projectsWithField();
  const rows = await db.select({ code: s.projects.code, name: s.projects.name, kind: s.projects.kind }).from(s.projects).orderBy(asc(s.projects.createdAt));
  return rows.filter((p) => p.code && p.code !== except && p.kind !== "parked" && withField.has(p.code) && onProject(u, p.code)).map((p) => ({ code: p.code!, name: p.name }));
}

/**
 * Copies one project's setup into another (lib/project-template), each part only where the new
 * project has none, in one transaction with one audit row. Nothing already set on the new project
 * is changed, so running it twice does nothing the second time.
 */
export async function copySetup(fromCode: string, toCode: string, by: AppUser): Promise<CopyResult> {
  if (fromCode === toCode) throw new HttpError(400, "Choose a different project to start from.");
  const [from, to] = [await projectByCode(fromCode), await projectByCode(toCode)];
  if (from.organizationId !== to.organizationId) throw new HttpError(404, `There is no project ${fromCode} here.`);
  const setup = await setupOf(from);
  if (!setup) throw new HttpError(409, `${fromCode} has no input package to start from.`);
  const team = (await people()).filter((p) => onProject(p, toCode));

  return db.transaction(async (tx) => {
    const state = async (projectId: string, key: string) => (await tx.select().from(s.projectState).where(eq(s.projectState.projectId, projectId))).find((r) => r.key === key)?.data ?? null;
    const put = (key: string, data: unknown) => tx.insert(s.projectState).values({ projectId: to.id, key, data }).onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });

    // Targets first, so the package can keep the target it counts toward.
    const mine = await tx.select({ code: s.indicators.code }).from(s.indicators).where(eq(s.indicators.projectId, to.id));
    const theirs = await tx.select().from(s.indicators).where(eq(s.indicators.projectId, from.id)).orderBy(asc(s.indicators.position));
    let targets = 0;
    if (!mine.length) {
      for (const i of theirs) {
        // A target fed by a KoboToolbox form on the other project takes recorded results here until its own form is linked.
        await tx.insert(s.indicators).values({ projectId: to.id, code: i.code, name: i.name, unit: i.unit, target: i.target, forecast: {}, level: i.level, result: i.result, source: "results", filter: null, frequency: i.frequency, theme: i.theme, disaggregation: i.disaggregation, verification: i.verification, inQuarterlyReport: i.inQuarterlyReport, position: i.position });
        targets++;
      }
    }
    const codes = targets ? theirs.map((i) => i.code) : mine.map((i) => i.code);

    const current = (await state(to.id, FIELD_SETUP_KEY)) as (FieldSetup & { draft?: boolean }) | null;
    const hadPackage = !!current?.items?.length && !current.draft;
    if (!hadPackage) await put(FIELD_SETUP_KEY, setupForCopy(setup, fromCode, codes));

    // A new project starts as "one named person" with nobody named: that is not a choice yet.
    const mineRule = (await state(to.id, KOBO_APPROVAL_KEY)) as KoboApproval | null;
    const hadApproval = !!mineRule && !(mineRule.who === "named" && !mineRule.person);
    const theirRule = (await state(from.id, KOBO_APPROVAL_KEY)) as KoboApproval | null;
    const rule = !hadApproval && theirRule ? approvalForCopy(theirRule, (id) => team.some((p) => p.id === id)) : null;
    if (rule) await put(KOBO_APPROVAL_KEY, rule);

    const copied = { package: !hadPackage, approval: !!rule, targets };
    const result: CopyResult = { from: fromCode, ...copied, notes: nextSteps(copied, { package: hadPackage, approval: hadApproval, targets: !!mine.length }, !hadApproval && !!theirRule && !rule) };
    await logAudit(tx, to.id, { entity: "project", entityId: crypto.randomUUID(), action: "setup_copied", by: by.id, detail: { from: fromCode, ...copied } });
    return result;
  });
}
