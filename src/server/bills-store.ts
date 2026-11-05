import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Bill } from "@/lib/bills";
import { projectByCode } from "@/server/field-store";

/** Bills paid directly, kept as one project_state document per project. */
export type BillBook = { items: Bill[]; next: number };

export async function loadBills(code: string): Promise<BillBook> {
  const project = await projectByCode(code);
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "bills")))
    .limit(1);
  return (row?.data as BillBook | undefined) ?? { items: [], next: 1 };
}

export async function saveBills(code: string, data: BillBook) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: "bills", data })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
}
