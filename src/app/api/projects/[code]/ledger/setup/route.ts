import { NextResponse } from "next/server";
import { guard, handle, HttpError } from "@/server/guard";
import { setUpBankAndCash } from "@/server/ledger-setup";
import { ledgerMay, ledgerProject } from "@/server/ledger-view";

type Ctx = { params: Promise<{ code: string }> };

/** One click: the organization's main bank account and cash on hand, so payments can be recorded. Finance or an administrator. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await guard(req, { write: true, allow: (u) => u.kind === "employee" });
    if (!(await ledgerMay(v.user)).setup) throw new HttpError(403, "Finance or an administrator sets up the bank and cash accounts.");
    const project = await ledgerProject(code);
    return NextResponse.json(await setUpBankAndCash(project.organizationId, v.user.id));
  }, "ledger");
}
