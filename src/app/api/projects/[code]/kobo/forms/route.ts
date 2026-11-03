import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { formsSchema } from "@/lib/kobo-setup";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { liveForms, readable, saveForms } from "@/server/kobo-link";

type Ctx = { params: Promise<{ code: string }> };
const WHY = "Only the project manager and plan approvers can change the KoboToolbox link.";

/** Every survey form on the connected account, read from KoboToolbox now. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    return readable(async () => NextResponse.json({ forms: await liveForms(code) }));
  });
}

/** The forms that belong to this project. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = formsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid form list." }, { status: 400 });
    return readable(async () => {
      await saveForms(code, parsed.data.forms);
      return NextResponse.json({ ok: true });
    });
  });
}
