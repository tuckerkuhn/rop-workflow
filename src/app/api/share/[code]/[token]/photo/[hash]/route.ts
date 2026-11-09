import { NextResponse } from "next/server";
import { handle } from "@/server/guard";
import { loadFile } from "@/server/hr-files";
import { sharedPhoto } from "@/server/share-store";

/** A captioned photo behind a donor link: only photos in that report or behind its figures. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string; token: string; hash: string }> }) {
  const { code, token, hash } = await params;
  return handle(async () => {
    if (!/^[0-9a-f]{64}$/.test(hash) || !(await sharedPhoto(code, token, hash))) return NextResponse.json({ error: "Not available." }, { status: 404 });
    const f = await loadFile(hash);
    if (!f) return NextResponse.json({ error: "Not available." }, { status: 404 });
    return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.type, "Cache-Control": "private, max-age=3600" } });
  });
}
