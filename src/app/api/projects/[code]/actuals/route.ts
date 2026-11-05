import { NextResponse } from "next/server";
import type { AppUser } from "@/lib/demo";
import { isSharePointUrl } from "@/lib/procurement";
import { requireViewer } from "@/server/auth";
import { fingerprint, loadActuals, readWorkbook, saveActuals } from "@/server/actuals-store";
import { handle } from "@/server/guard";
import { holdsRole } from "@/server/hr-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Monthly budget against actual. Finance (or whoever holds the NetSuite import role on the
 * project) uploads the workbook sent to UNDP with the FACE form; ?check=1 reads it and shows
 * what would be imported without saving anything.
 */

const MAX = 15 * 1024 * 1024;
async function mayImport(u: AppUser) {
  return u.kind === "employee" && (u.project.includes("finance-import") || (await holdsRole(u.id, "finance")));
}

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const a = await loadActuals(code);
    return NextResponse.json({ ...a, mayImport: await mayImport(v.user) });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    if (!(await mayImport(v.user))) return NextResponse.json({ error: "Only Finance and the people named for the NetSuite import can import spending." }, { status: 403 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the workbook." }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: "That file is over 15 MB." }, { status: 400 });
    const sharepointUrl = String(form?.get("sharepointUrl") ?? "").trim() || null;
    if (sharepointUrl && !isSharePointUrl(sharepointUrl)) return NextResponse.json({ error: "That is not a link to ROP's SharePoint." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const bva = await readWorkbook(buf);
    const check = new URL(req.url).searchParams.get("check") === "1";
    if (check || bva.problems.length) return NextResponse.json({ preview: bva, saved: false }, { status: bva.problems.length && !check ? 400 : 200 });
    const out = await saveActuals(code, bva, { name: file.name.slice(0, 200), hash: fingerprint(buf), sharepointUrl }, v.user.id);
    return NextResponse.json({ preview: bva, saved: true, ...out, ...(await loadActuals(code)), mayImport: true });
  });
}
