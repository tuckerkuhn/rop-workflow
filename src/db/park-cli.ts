/**
 * Sets a project aside, or brings it back. A parked project keeps all its data but is hidden from
 * the project picker, lists, boards, totals and emails, its pages answer as if it were not there,
 * and its Kobo forms are not synced on the schedule.
 *
 *   npm run park -- ACRP-2026            park it
 *   npm run park -- ACRP-2026 --unpark   bring it back as a real project
 */
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { PARKED } from "@/server/project-store";

async function main() {
  const [code, flag] = process.argv.slice(2);
  if (!code) throw new Error("Name the project, e.g. npm run park -- ACRP-2026");
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) throw new Error(`No project ${code}.`);
  const unpark = flag === "--unpark";
  if (unpark ? p.kind !== PARKED : p.kind !== "real") throw new Error(`${code} is ${p.kind}; only a ${unpark ? "parked" : "real"} project can be ${unpark ? "brought back" : "parked"}.`);
  const kind = unpark ? "real" : PARKED;
  await db.transaction(async (tx) => {
    await tx.update(s.projects).set({ kind, updatedAt: new Date() }).where(eq(s.projects.id, p.id));
    await tx.insert(s.auditLog).values({ projectId: p.id, entity: "project", entityId: p.id, action: unpark ? "project_unparked" : "project_parked", detail: { by: "park-cli" } });
  });
  console.log(`${code} is ${unpark ? "back as a real project" : "parked: hidden, data kept"}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
