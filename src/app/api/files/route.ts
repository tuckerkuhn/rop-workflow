import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { FILE_TYPES, MAX_FILE, saveFile } from "@/server/hr-files";

/** Upload a receipt. Returns its fingerprint, which the expense report then refers to. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
    if (!(FILE_TYPES as readonly string[]).includes(file.type)) return NextResponse.json({ error: "Receipts must be a photo (JPEG, PNG, WebP) or a PDF." }, { status: 400 });
    if (file.size > MAX_FILE) return NextResponse.json({ error: "That file is over 4 MB. Take the photo again, or scan the PDF at a lower resolution." }, { status: 400 });
    return NextResponse.json(await saveFile(Buffer.from(await file.arrayBuffer()), file.name || "receipt", file.type, v.user.id));
  });
}
