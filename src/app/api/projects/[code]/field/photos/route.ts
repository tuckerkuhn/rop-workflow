import { NextResponse } from "next/server";
import { z } from "zod";
import { PHOTO_MAX_CHARS } from "@/lib/plans";
import { requireViewer } from "@/server/auth";
import { addFarmerPhoto, FARMER_TAGS, mayAddPhoto, tagsFor } from "@/server/farmer-photo";
import { handle, readBody } from "@/server/guard";

/**
 * Photos on a farmer's record, for anyone on the project who visits farmers.
 *   GET   which tags this person may use
 *   POST  add one photo: the farmer, one tag, the photo, and what the photo says of itself
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ may: mayAddPhoto(v.user, code), tags: mayAddPhoto(v.user, code) ? tagsFor(v.user) : [] });
  });
}

const body = z.object({
  farmerId: z.string().min(1).max(60),
  tag: z.enum(FARMER_TAGS),
  src: z.string().max(PHOTO_MAX_CHARS).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "That file is not a photo the app can keep."),
  taken: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional() }).nullable().optional(),
  gps: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => mayAddPhoto(u, code), why: "Only staff on this project who can open Field activities can add a photo to a farmer." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body);
    return NextResponse.json({ photo: await addFarmerPhoto(code, b.farmerId, v.user, b) });
  });
}
