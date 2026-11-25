import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { isFieldFormKind } from "@/lib/field-forms";
import { distributionFormFile, fieldFormFile } from "@/server/distribution-form";
import { HttpError, audit, handle } from "@/server/guard";

/**
 * GET: one of this project's KoboCollect forms as a file to upload in KoboToolbox. With no `kind`,
 * the distribution form, made from the input package saved in Field activities. With
 * `?kind=readiness`, `training` or `visit`, that form. For the people who set the project up: the
 * project manager and plan approvers.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && (canEditProject(u) || u.fieldAccess === "edit"), why: "Only people who set up Field activities on this project can download its form." });
    if (v instanceof NextResponse) return v;
    const kind = new URL(req.url).searchParams.get("kind") ?? "distribution";
    if (kind !== "distribution" && !isFieldFormKind(kind)) throw new HttpError(400, "There is no form of that kind. Choose the readiness check, training attendance, farm visit or distribution form.");
    const file = kind === "distribution" ? await distributionFormFile(code) : await fieldFormFile(code, kind);
    if (kind === "distribution") await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "distribution_form_downloaded", by: v.user.id, detail: { items: "items" in file ? file.items : 0 } });
    else await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_form_downloaded", by: v.user.id, detail: { kind } });
    return new NextResponse(new Uint8Array(file.bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "private, no-store" } });
  });
}
