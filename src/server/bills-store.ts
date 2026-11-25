import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Bill } from "@/lib/bills";
import type { AppUser } from "@/lib/demo";
import { projectByCode } from "@/server/field-store";
import { loadHr } from "@/server/hr-store";

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

/** What a person may do with bills. Who holds which role comes from the authority table. */
export async function billRoles(u: AppUser) {
  const holders = (await loadHr()).state.rules?.holders;
  const has = (t: "management" | "ceo" | "finance" | "bills") => !!holders?.[t]?.includes(u.id);
  return {
    // Recording bills is given, not assumed: Finance, and the people named for bill entry.
    record: has("finance") || has("bills") || u.procurement.includes("finance"),
    approve: has("management") || has("ceo") || u.procurement.includes("approver"),
    voucher: has("finance") || u.procurement.includes("finance"),
  };
}
