import { NextResponse } from "next/server";
import { PHOTO_MAX_CHARS } from "@/lib/plans";
import { z } from "zod";
import type { FieldItem } from "@/lib/field";
import { requireViewer } from "@/server/auth";
import { loadField, saveItems, saveStock } from "@/server/field-store";
import { recordFromApp } from "@/server/distribution";
import type { Farmer } from "@/lib/field";
import { audit, handle, readBody } from "@/server/guard";

/** Field activities state for a project. Names are included only for roles allowed to see them. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.fieldAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadField(code, v.user));
  });
}

const short = z.string().max(400);
const issue = z.looseObject({ id: short, type: short, note: z.string().max(4000), by: short, blocking: z.boolean(), status: z.enum(["open", "resolved"]), resolution: z.string().max(4000).optional() });
const event = z.looseObject({ date: short, who: short, what: z.string().max(4000) });
/** What every record carries. Fields a kind adds are kept as sent, within the size limits here. */
const common = { id: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/), step: z.string().min(1).max(60), checks: z.record(z.string().max(80), z.boolean()), issues: z.array(issue).max(200), timeline: z.array(event).max(1000) };
const farmer = z.looseObject({
  ...common,
  kind: z.literal("farmer"),
  orgId: short,
  name: z.string().max(200),
  gender: z.enum(["Female", "Male"]),
  ageBand: z.enum(["18–29 (youth)", "30–49", "50+"]),
  householdSize: z.number().int().min(0).max(100),
  community: short,
  hectares: z.number().min(0).max(100000),
  enrolled: z.boolean(),
  enrolledOn: short,
  contributionPaid: z.boolean(),
  deadline: short.optional(),
  correction: z.string().max(4000).optional(),
  surveys: z.array(z.looseObject({ date: short, score: z.number(), comment: z.string().max(4000), by: short })).max(200),
  photos: z.array(z.looseObject({ id: short, activity: z.enum(["training", "landprep", "visit", "distribution", "planting"]), date: short, caption: z.string().max(1000), src: z.string().max(PHOTO_MAX_CHARS).optional() })).max(200),
  stories: z.array(z.looseObject({ id: short, status: z.enum(["note", "completed"]), title: short, text: z.string().max(20000), date: short, by: short })).max(100),
});
const finding = z.looseObject({
  ...common,
  kind: z.literal("finding"),
  orgId: short.optional(),
  title: short,
  summary: z.string().max(8000),
  sources: z.array(short).max(100),
  ai: z.array(z.string().max(4000)).max(50).optional(),
  action: z.object({ text: z.string().max(4000), owner: z.enum(["extension", "mel", "store", "manager"]), due: short }).optional(),
});
const bodySchema = z.object({
  items: z.array(z.discriminatedUnion("kind", [farmer, finding])).max(500).optional(),
  stock: z.object({ seed: z.number().min(0).max(1e9), npk: z.number().min(0).max(1e9) }).optional(),
});

/** Saves changed items and/or the store stock. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.fieldAccess === "edit", why: "You can view Field activities but not change them." });
    if (v instanceof NextResponse) return v;
    const body = await readBody(req, bodySchema, "That record is not complete, so it was not saved. Reload the page and try again.");
    const items: FieldItem[] = body.items ?? [];
    // A farmer leaving "distribute" means the input package was handed out: check the goods
    // received note and quantities first (refused if not), then it goes to the manager to approve.
    const before = new Map((await loadField(code, v.user)).items.map((i) => [i.id, i.step]));
    const handedOut = items.filter((i): i is Farmer => i.kind === "farmer" && before.get(i.id) === "distribute" && i.step === "plant");
    const recorded: string[] = [];
    for (const f of handedOut) recorded.push(await recordFromApp(code, f, v.user, new URL(req.url).origin));
    if (items.length) await saveItems(code, items);
    if (body.stock) await saveStock(code, body.stock);
    if (items.length || body.stock)
      await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_saved", by: v.user.id, detail: { items: items.map((i) => ({ id: i.id, kind: i.kind, step: i.step })), ...(body.stock ? { stock: body.stock } : {}) } });
    return NextResponse.json({ ok: true, distributions: recorded });
  });
}
