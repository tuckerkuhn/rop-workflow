import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { registerAuthority } from "@/lib/authority";
import type { AppUser } from "@/lib/demo";
import { isSharePointUrl, procRolesFor } from "@/lib/procurement";
import { applySupplierAction, supplierAction, supplierGaps } from "@/lib/suppliers";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr } from "@/server/hr-store";
import { orgIdForPerson, orgProfile } from "@/server/org-settings-store";
import { loadSuppliers, saveSuppliers } from "@/server/suppliers-store";

/**
 * The supplier register. Everyone with procurement access reads it; procurement staff add
 * suppliers, record screenings and declarations; Finance confirms bank details. Every change is
 * kept in the supplier's history and the audit trail.
 */

const today = () => new Date().toISOString().slice(0, 10);

async function who(u: AppUser) {
  registerAuthority((await loadHr().catch(() => null))?.state.rules?.holders ?? {});
  const roles = procRolesFor(u);
  return { id: u.id, name: u.name, manage: roles.includes("procurement") || !!u.admin, finance: roles.includes("finance") };
}

async function view(orgId: string, u: AppUser) {
  const reg = await loadSuppliers(orgId);
  const rescreen = (await orgProfile(orgId)).values.rescreenMonths?.value;
  const months = typeof rescreen === "number" ? rescreen : 6;
  const w = await who(u);
  return {
    suppliers: [...reg.suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ ...x, gaps: supplierGaps(x, today(), months) })),
    rescreenMonths: months,
    can: { manage: w.manage, finance: w.finance },
  };
}
export type SuppliersView = Awaited<ReturnType<typeof view>>;

async function orgOf(u: AppUser) {
  const id = await orgIdForPerson(u.id);
  if (!id) throw new Error("No organization is set up yet.");
  return id;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(await orgOf(v.user), v.user));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.procurementAccess === "edit", why: "You can view suppliers but not change them." });
    if (v instanceof NextResponse) return v;
    const parsed = supplierAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    // Evidence lives in ROP's SharePoint, so a link is checkable by anyone with access.
    const links = [a.action === "add" || a.action === "edit" ? a.fields.licenceEvidence : "", "evidence" in a ? a.evidence : ""].filter(Boolean);
    if (links.some((l) => !isSharePointUrl(l))) return NextResponse.json({ error: "Evidence must be a link to the file in ROP's SharePoint." }, { status: 400 });
    const orgId = await orgOf(v.user);
    const reg = await loadSuppliers(orgId);
    const out = applySupplierAction(reg, a, await who(v.user), today(), () => `SUP-${randomUUID().slice(0, 8).toUpperCase()}`);
    if (typeof out === "string") return NextResponse.json({ error: out }, { status: 409 });
    await saveSuppliers(orgId, out);
    const id = a.action === "add" ? out.suppliers[out.suppliers.length - 1].id : a.id;
    await db.insert(s.auditLog).values({ projectId: null, entity: "supplier", entityId: orgId, action: `supplier_${a.action}`, detail: { by: v.user.id, supplier: id, name: out.suppliers.find((x) => x.id === id)?.name } });
    return NextResponse.json(await view(orgId, v.user));
  });
}
