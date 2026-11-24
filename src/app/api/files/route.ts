import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { EXCEL_TYPE, FILE_TYPES, MAX_FILE, WORD_TYPE, documentType, saveFile } from "@/server/hr-files";

/** Upload a receipt. Returns its fingerprint, which the expense report then refers to. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
    // A document (a funding call) may also be a Word or Excel file; a receipt may not.
    const document = form?.get("purpose") === "document";
    const type = document ? documentType(file.name, file.type) : file.type;
    if (!(FILE_TYPES as readonly string[]).includes(type) && !(document && (type === WORD_TYPE || type === EXCEL_TYPE)))
      return NextResponse.json({ error: document ? `${file.name}: attach a PDF, a Word file (.docx) or an Excel file (.xlsx).` : "Receipts must be a photo (JPEG, PNG, WebP) or a PDF." }, { status: 400 });
    if (file.size > MAX_FILE)
      return NextResponse.json({ error: document ? `${file.name} is over 4 MB. Attach the main part of the call and put the link to the full call in the link box.` : "That file is over 4 MB. Take the photo again, or scan the PDF at a lower resolution." }, { status: 400 });
    return NextResponse.json(await saveFile(Buffer.from(await file.arrayBuffer()), file.name || "receipt", type, v.user.id));
  });
}
