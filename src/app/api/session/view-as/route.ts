import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { demoMode, getViewer, VIEW_AS_COOKIE } from "@/server/auth";
import { handle } from "@/server/guard";

/** Starts or stops "View as": { id } to view as that person, { id: null } to stop. Admins only; logged. */
export async function POST(req: Request) {
  return handle(async () => {
    if (demoMode()) return NextResponse.json({ error: "In demo mode, pick the person on the sign-in page instead." }, { status: 400 });
    const v = await getViewer(req);
    if (!v) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (!v.actor.admin) return NextResponse.json({ error: "View as is limited to administrators." }, { status: 403 });

    const { id } = (await req.json()) as { id: string | null };
    const store = await cookies();
    if (!id || id === v.actor.id) {
      store.delete(VIEW_AS_COOKIE);
      return NextResponse.json({ ok: true });
    }
    const [target] = await db.select().from(s.staff).where(eq(s.staff.personId, id)).limit(1);
    if (!target?.active) return NextResponse.json({ error: "That person is not on the staff list." }, { status: 404 });

    store.set(VIEW_AS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
    await db.insert(s.auditLog).values({ actorId: v.actorStaffId, entity: "session", entityId: target.id, action: "view_as", detail: { by: v.actor.id, as: id } });
    return NextResponse.json({ ok: true });
  });
}
