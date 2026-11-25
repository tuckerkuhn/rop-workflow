import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { distributionFormFile } from "@/server/distribution-form";
import { audit, handle } from "@/server/guard";

/**
 * GET: this project's KoboCollect distribution form, made from the input package saved in Field
 * activities. For the people who set the package up: the project manager and plan approvers.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && (canEditProject(u) || u.fieldAccess === "edit"), why: "Only people who set up Field activities on this project can download its form." });
    if (v instanceof NextResponse) return v;
    const file = await distributionFormFile(code);
    await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "distribution_form_downloaded", by: v.user.id, detail: { items: file.items } });
    return new NextResponse(new Uint8Array(file.bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "private, no-store" } });
  });
}
