import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { demoMode, people } from "@/server/auth";

/** People who may hold an approval role: everyone in the demo cast; on the live site, active staff with a sign-in email. */
export async function eligibleSigners(): Promise<string[]> {
  if (demoMode()) return (await people()).filter((p) => p.kind === "employee").map((p) => p.id);
  const rows = await db.select({ id: s.staff.personId, profile: s.staff.profile }).from(s.staff).where(and(eq(s.staff.active, true), isNotNull(s.staff.email)));
  return rows.filter((r) => r.id && (r.profile as { kind?: string } | null)?.kind !== "donor").map((r) => r.id!);
}
