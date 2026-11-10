import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { formsSchema } from "@/lib/kobo-setup";
import { requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { koboState, liveForms, readable, saveForms } from "@/server/kobo-link";

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
      const before = await koboState(code);
      await saveForms(code, parsed.data.forms);
      const kept = new Set(parsed.data.forms.map((f) => f.uid));
      const dropped = before.forms.filter((f) => !kept.has(f.uid));
      // Taking a form off the project also removes the question mappings on it.
      await audit(code, { entity: "kobo", entityId: crypto.randomUUID(), action: "kobo_forms_saved", by: v.user.id, detail: { forms: parsed.data.forms.map((f) => ({ name: f.name, purpose: f.purpose })), removed: dropped.map((f) => f.name), mappingsRemoved: before.mappings.filter((m) => !kept.has(m.assetUid)).map((m) => m.indicatorCode) } });
      return NextResponse.json({ ok: true });
    });
  });
}
