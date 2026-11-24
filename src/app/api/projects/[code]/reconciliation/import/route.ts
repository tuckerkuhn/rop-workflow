import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { importStatement, mayReadReconciliation, mayReconcile } from "@/server/reconciliation";
import { refusal } from "../http";

type Ctx = { params: Promise<{ code: string }> };

const col = z.number().int().min(0).max(200);
const body = z.object({
  bankAccountId: z.string().uuid("Choose the bank account."),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Say which month (YYYY-MM)."),
  csv: z.string().min(1, "The file is empty.").max(2_000_000, "The file is too large. Export one month at a time."),
  mapping: z.object({
    headerRow: z.number().int().min(0).max(1000),
    date: col,
    description: col,
    amount: col.nullable().optional(),
    moneyIn: col.nullable().optional(),
    moneyOut: col.nullable().optional(),
    balance: col.nullable().optional(),
    dateFormat: z.enum(["ymd", "dmy"]),
  }),
});

/** Finance imports a bank statement (CSV text and the column mapping they confirmed) for one bank account and month. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayReadReconciliation, why: "Bank reconciliation is for the organization's staff." });
    if (v instanceof NextResponse) return v;
    if (!(await mayReconcile(v.user))) return NextResponse.json({ error: "Only Finance or an administrator imports a bank statement." }, { status: 403 });
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const project = await projectByCode(decodeURIComponent(code));
    try {
      return NextResponse.json(await importStatement({ organizationId: project.organizationId, ...parsed.data, by: v.user.id, projectId: project.id }));
    } catch (e) {
      return refusal(e);
    }
  }, "reconciliation");
}
