import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { connectSchema } from "@/lib/kobo-setup";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { connect, disconnect, koboState, readable } from "@/server/kobo-link";

type Ctx = { params: Promise<{ code: string }> };
const WHY = "Only the project manager and plan approvers can change the KoboToolbox link.";

/** The project's KoboToolbox link: account (never the token), chosen forms and mappings. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await koboState(code));
  });
}

/** Connects or updates the account. The token is checked with KoboToolbox, then stored encrypted. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = connectSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter the server address and API token." }, { status: 400 });
    return readable(async () => {
      await connect(code, parsed.data, v.user.id);
      return NextResponse.json(await koboState(code));
    });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    return readable(async () => {
      await disconnect(code);
      return NextResponse.json({ ok: true });
    });
  });
}
