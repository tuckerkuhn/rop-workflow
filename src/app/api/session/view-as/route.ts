import { eq } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { demoMode, getViewer, VIEW_AS_COOKIE } from "@/server/auth";
import { handle, readBody } from "@/server/guard";

/** Starts or stops "View as": { id } to view as that person, { id: null } to stop. Admins only; logged. */
export async function POST(req: Request) {
  return handle(async () => {
    if (demoMode()) return NextResponse.json({ error: "In demo mode, pick the person on the sign-in page instead." }, { status: 400 });
    const v = await getViewer(req);
    if (!v) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (v.twoStep) return NextResponse.json({ error: "Enter the code from your authenticator app first." }, { status: 401 });
    if (!v.actor.admin) return NextResponse.json({ error: "View as is limited to administrators." }, { status: 403 });

    const { id } = await readBody(req, z.object({ id: z.string().min(1).max(80).nullable() }), "Choose a person to view as.");
    const store = await cookies();
    if (!id || id === v.actor.id) {
      const was = store.get(VIEW_AS_COOKIE)?.value ?? null;
      store.delete(VIEW_AS_COOKIE);
      // The trail shows when View as ended as well as when it began.
      if (was && v.actorStaffId) await db.insert(s.auditLog).values({ actorId: v.actorStaffId, entity: "session", entityId: v.actorStaffId, action: "view_as_stopped", detail: { by: v.actor.id, as: was } });
      return NextResponse.json({ ok: true });
    }
    const [target] = await db.select().from(s.staff).where(eq(s.staff.personId, id)).limit(1);
    // Only someone in the administrator's own organization.
    if (!target?.active || (v.organizationId && target.organizationId !== v.organizationId)) return NextResponse.json({ error: "That person is not on the staff list." }, { status: 404 });

    store.set(VIEW_AS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
    await db.insert(s.auditLog).values({ actorId: v.actorStaffId, entity: "session", entityId: target.id, action: "view_as", detail: { by: v.actor.id, as: id } });
    return NextResponse.json({ ok: true });
  });
}
