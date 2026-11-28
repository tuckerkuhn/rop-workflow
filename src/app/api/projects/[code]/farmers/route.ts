import { AGE_BANDS } from "@/lib/field";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject, canSeePII } from "@/lib/demo";
import { FARMER_ID, START_STEPS } from "@/lib/farmer-import";
import { requireViewer } from "@/server/auth";
import { importFarmers } from "@/server/farmers";
import { handle, readBody } from "@/server/guard";

const row = z.object({
  id: z.string().regex(FARMER_ID),
  village: z.string().trim().min(1).max(120),
  gender: z.enum(["Female", "Male"]),
  hectares: z.number().min(0).max(10000),
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().regex(/^\+?[\d\s().-]{7,20}$/).optional(),
  ageBand: z.enum(AGE_BANDS).optional(),
  householdSize: z.number().int().min(0).max(100).optional(),
  household: z.array(z.object({ sex: z.enum(["Female", "Male"]), age: z.number().int().min(0).max(120) })).max(100).optional(),
  contributionPaid: z.boolean().optional(),
  step: z.enum(START_STEPS).optional(),
});
const body = z.object({ rows: z.array(row).min(1).max(5000), duplicatesChecked: z.boolean().optional() });

/** Loads a farmer list into the project's Field activities (server/farmers). */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, {
      write: true,
      allow: (u) => u.kind === "employee" && (canEditProject(u) || (u.fieldAccess === "edit" && u.field.includes("manager"))),
      why: "Only the project manager and plan approvers can load the farmer list.",
    });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "The farmer list could not be read. Check it against the template and try again.");
    // Names are personal data: only someone who may see them may add them.
    if (b.rows.some((r) => r.name || r.phone) && !canSeePII(v.user))
      return NextResponse.json({ error: "Your role cannot see farmer names, so it cannot add them. Remove the Name column, or ask someone with access to participants' names to load the list." }, { status: 403 });
    return NextResponse.json(await importFarmers(code, b.rows, { id: v.user.id, name: v.user.name }, { duplicatesChecked: b.duplicatesChecked }));
  });
}
