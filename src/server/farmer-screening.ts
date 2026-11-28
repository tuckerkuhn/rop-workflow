import { canSeePII, type AppUser } from "@/lib/demo";
import { db, schema as s } from "@/db";
import type { FarmerScreeningInput } from "@/lib/farmer-screening";
import { realToday } from "@/lib/clock";
import { changeFarmer } from "@/server/distribution";
import { projectByCode } from "@/server/field-store";
import { HttpError } from "@/server/guard";

/**
 * Records a farmer's sanctions screening (lib/farmer-screening, MF-04) on their record, with a line
 * in their history and the audit log. Only someone who may see farmers' names checks the lists,
 * since the check is made by name.
 */
export const mayScreenFarmers = (u: AppUser, code: string) => u.kind === "employee" && canSeePII(u) && (u.projects ? u.projects.includes(code) : true) && (u.fieldAccess === "edit" || u.project.includes("mel-owner"));

export async function screenFarmer(code: string, input: FarmerScreeningInput, by: AppUser) {
  if (!mayScreenFarmers(by, code)) throw new HttpError(403, "Only staff who may see farmers' names and record field work screen a farmer: the check is made by name.");
  if (input.date > realToday()) throw new HttpError(400, "A screening cannot be dated in the future.");
  const project = await projectByCode(code);
  let found = false;
  await db.transaction(async (tx) => {
    await changeFarmer(tx, project.id, input.farmer, (f) => {
      found = true;
      const entry = { date: input.date, lists: input.lists, result: input.result, ...(input.note ? { note: input.note } : {}), by: by.id, byName: by.name };
      const what = input.result === "clear" ? `Screened against the sanctions lists: clear (${input.lists}), by ${by.name}` : `Screened against the sanctions lists: a possible match, for a person to review, by ${by.name}`;
      return { ...f, screenings: [...(f.screenings ?? []), entry], timeline: [...f.timeline, { date: realToday(), who: "manager", what }] };
    });
    if (found) await tx.insert(s.auditLog).values({ projectId: project.id, entity: "farmer", entityId: crypto.randomUUID(), action: "farmer_screened", detail: { by: by.id, farmer: input.farmer, date: input.date, result: input.result } });
  });
  if (!found) throw new HttpError(404, `${input.farmer} is not on this project's farmer list.`);
}
