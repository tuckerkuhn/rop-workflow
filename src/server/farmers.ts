import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { realToday } from "@/lib/clock";
import { ORG_ID } from "@/lib/demo";
import type { FarmerRow } from "@/lib/farmer-import";
import { afterTrainInputs, type Farmer } from "@/lib/field";
import { selectionHold } from "@/lib/selection";
import { selectionOutcomes } from "@/server/selection-store";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";

/**
 * Loads a farmer list into a project's Field activities. Each farmer becomes:
 * - a `farmers` row (ID, village, initials for devices, status),
 * - a `farmer_pii` row with the name, only when the list has names (never anywhere else),
 * - a `field_items` record at the step the list gives (train by default).
 * A farmer already on the project keeps their progress: only village and sex/hectares on a
 * record not yet past "train" are updated. An ID used on another project is refused.
 */

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join("");

export async function importFarmers(code: string, rows: FarmerRow[], by: { id: string; name: string }) {
  const project = await projectByCode(code);
  const ids = rows.map((r) => r.id);
  const existing = ids.length ? await db.select().from(s.farmers).where(inArray(s.farmers.code, ids)) : [];
  const elsewhere = existing.filter((f) => f.projectId !== project.id);
  if (elsewhere.length)
    throw new HttpError(409, `These farmer IDs are already used on another project: ${elsewhere.slice(0, 10).map((f) => f.code).join(", ")}${elsewhere.length > 10 ? ` and ${elsewhere.length - 10} more` : ""}. Farmer IDs must be unique across projects; give these farmers new IDs.`);
  const mine = new Map(existing.map((f) => [f.code, f]));
  const items = new Map(
    (await db.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, project.id), inArray(s.fieldItems.itemKey, ids.concat("__none__"))))).map((r) => [r.itemKey, r]),
  );
  const day = realToday();
  // Read before the transaction opens: the Train rule (lib/field afterTrainInputs) needs it.
  const outcomes = await selectionOutcomes(project.id);
  let added = 0;
  let updated = 0;

  await db.transaction(async (tx) => {
    for (const r of rows) {
      const known = mine.get(r.id);
      const farmerId = known
        ? (
            await tx
              .update(s.farmers)
              .set({ village: r.village, ...(r.name ? { householdHeadInitials: initials(r.name) } : {}), ...(r.contributionPaid !== undefined ? { contributionPaid: r.contributionPaid } : {}), updatedAt: new Date() })
              .where(eq(s.farmers.id, known.id))
              .returning({ id: s.farmers.id })
          )[0].id
        : (
            await tx
              .insert(s.farmers)
              .values({ organizationId: project.organizationId, projectId: project.id, code: r.id, village: r.village, householdHeadInitials: r.name ? initials(r.name) : null, status: "enrolled", contributionPaid: r.contributionPaid ?? false, enrolledOn: day })
              .returning({ id: s.farmers.id })
          )[0].id;
      if (r.name)
        await tx
          .insert(s.farmerPii)
          .values({ farmerId, fullName: r.name })
          .onConflictDoUpdate({ target: s.farmerPii.farmerId, set: { fullName: r.name, updatedAt: new Date() } });

      const item = items.get(r.id);
      if (item) {
        const f = item.data as Farmer;
        // Progress is kept; details are corrected only before any step has been recorded.
        const fresh = f.step === "train" && f.timeline.length <= 1;
        const changed: Farmer = { ...f, community: r.village, ...(fresh ? { gender: r.gender, hectares: r.hectares } : {}), ...(r.ageBand ? { ageBand: r.ageBand } : {}), ...(r.householdSize !== undefined ? { householdSize: r.householdSize } : {}), ...(r.household ? { household: r.household } : {}), ...(r.contributionPaid !== undefined ? { contributionPaid: r.contributionPaid } : {}) };
        // A contribution marked paid on the list moves on a farmer whose training is already recorded.
        const next = afterTrainInputs(f, changed, day, selectionHold(outcomes, r.id)) as Farmer;
        await tx.update(s.fieldItems).set({ data: next, updatedAt: new Date() }).where(eq(s.fieldItems.id, item.id));
        updated++;
        continue;
      }
      const farmer: Farmer = {
        kind: "farmer",
        orgId: ORG_ID,
        id: r.id,
        name: "",
        gender: r.gender,
        ageBand: r.ageBand ?? "36–49",
        householdSize: r.householdSize ?? 0,
        ...(r.household ? { household: r.household } : {}),
        community: r.village,
        hectares: r.hectares,
        enrolled: true,
        enrolledOn: day,
        contributionPaid: r.contributionPaid ?? false,
        step: r.step ?? "train",
        checks: {},
        issues: [],
        timeline: [{ date: day, who: "manager", what: `Added from the farmer list by ${by.name}${r.step && r.step !== "train" ? `, starting at ${r.step}` : ""}` }],
        surveys: [],
        photos: [],
        stories: [],
      };
      await tx.insert(s.fieldItems).values({ organizationId: project.organizationId, projectId: project.id, itemKey: r.id, kind: "farmer", data: farmer });
      added++;
    }
    await tx.insert(s.auditLog).values({ projectId: project.id, entity: "field", entityId: crypto.randomUUID(), action: "farmers_imported", detail: { by: by.id, added, updated, withNames: rows.filter((r) => r.name).length } });
  });
  return { added, updated };
}
