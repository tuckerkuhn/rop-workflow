import { NextResponse } from "next/server";
import { onProject, requireViewer } from "@/server/auth";
import { fetchPhoto, storeMode } from "@/server/file-store";
import { handle } from "@/server/guard";
import { recordError } from "@/server/limits";

/**
 * A proof photo kept in file storage (server/file-store), for staff on the project. Its fingerprint
 * is checked as it is read: a file changed after it was saved is not shown as if it were the same,
 * and the change is recorded for the administrators (Settings, Health).
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; hash: string }> }) {
  const { code: raw, hash } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && onProject(u, code), why: "Only staff on this project can open its photos." });
    if (v instanceof NextResponse) return v;
    if (!/^[0-9a-f]{64}$/.test(hash) || storeMode() !== "supabase") return NextResponse.json({ error: "No such photo." }, { status: 404 });
    const f = await fetchPhoto(code, hash);
    if (!f) return NextResponse.json({ error: "No such photo." }, { status: 404 });
    if (!f.intact) {
      await recordError(`photo ${code}`, new Error(`A stored photo no longer matches its fingerprint: project ${code}, photo ${hash.slice(0, 16)}. It was changed after it was saved.`));
      return NextResponse.json({ error: "This photo was changed after it was saved, so it is not shown. An administrator has been told." }, { status: 409 });
    }
    return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": f.type, "Cache-Control": "private, max-age=3600" } });
  });
}
