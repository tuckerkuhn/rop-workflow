import { NextResponse } from "next/server";
import { PHOTO_MAX_CHARS } from "@/lib/plans";
import { z } from "zod";
import type { FieldItem } from "@/lib/field";
import { requireViewer } from "@/server/auth";
import { loadField, saveEdited, saveStock } from "@/server/field-store";
import { countPlanting, recordFromApp, stockFor } from "@/server/distribution";
import { moveProblem, stepRefusal, type Farmer } from "@/lib/field";
import { today } from "@/lib/clock";
import { hectaresFor } from "@/lib/crops";
import { audit, handle, HttpError, readBody } from "@/server/guard";

/** Field activities state for a project. Names are included only for roles allowed to see them. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.fieldAccess !== "none" });
    if (v instanceof NextResponse) return v;
    const field = await loadField(code, v.user);
    // One figure for the store: what purchases have received less what has been handed out.
    // A project with no purchase for the package keeps the stock typed in Field activities.
    const derived = await stockFor(code);
    return NextResponse.json({ ...field, stock: derived?.stock ?? field.stock, stockFrom: derived ? "purchases" : "store", stockNote: derived?.block ?? null });
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
  planting: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hectares: z.number().min(0).max(100000), count: z.number().int().min(0).max(1e7).optional() }).optional(),
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
  stock: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), z.number().min(0).max(1e9)).optional(),
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
    const field = await loadField(code, v.user);
    const stored = new Map(field.items.map((i) => [i.id, i]));
    const before = new Map(field.items.map((i) => [i.id, i.step]));
    // A stale page never writes over newer work: each record must be the version the page read.
    const stale = items.find((i) => stored.has(i.id) && stored.get(i.id)!.rev !== i.rev);
    if (stale) throw new HttpError(409, `${stale.kind === "farmer" ? `Farmer ${stale.id}` : `Finding ${stale.id}`} was changed by someone else since you opened this page, so your change was not saved. The page now shows the latest; make your change again.`);
    // A farmer moves only along the workflow, from the step the database holds (lib/field moveProblem),
    // by the step's owner, with its checks done (stepRefusal): the screen's rules, enforced here.
    const derivedBefore = await stockFor(code);
    const ctx = { stock: derivedBefore?.stock ?? field.stock ?? {}, stockNote: derivedBefore?.block ?? null, setup: field.setup ?? { items: [] }, today: today() };
    const wrong = items.map((i) => moveProblem(before.get(i.id), i) ?? (stored.has(i.id) ? stepRefusal(stored.get(i.id)!, i, v.user.field, ctx) : null)).find(Boolean);
    if (wrong) return NextResponse.json({ error: wrong }, { status: 409 });
    // The planting record is entered at "Plant and follow up", by the extension agent, and is
    // fixed once planting is recorded: the result counted from it never changes under MEL.
    for (const i of items) {
      if (i.kind !== "farmer") continue;
      const was = stored.get(i.id);
      const before = was?.kind === "farmer" ? was.planting : undefined;
      if (JSON.stringify(before ?? null) === JSON.stringify(i.planting ?? null)) continue;
      if (was?.step !== "plant") return NextResponse.json({ error: `Farmer ${i.id}: the planting record can only be entered at "Plant and follow up"${was?.step === "complete" ? ", and this farmer's planting is already recorded" : ""}.` }, { status: 409 });
      if (!v.user.field.includes("extension")) return NextResponse.json({ error: `Farmer ${i.id}: the planting record is for the extension agent to enter.` }, { status: 403 });
      // For a crop counted one by one, the hectares are worked out from the count, never typed (lib/crops).
      const fromCount = i.planting?.count !== undefined ? hectaresFor(i.planting.count, ctx.setup.plan) : null;
      if (i.planting && fromCount !== null && Math.abs(fromCount - i.planting.hectares) > 0.005) return NextResponse.json({ error: `Farmer ${i.id}: ${i.planting.count} planted at the project's spacing is ${fromCount} ha, not ${i.planting.hectares}. Reload and save again.` }, { status: 400 });
    }
    // Server-owned: whether a distribution waits for approval is never taken from the page.
    for (const i of items) {
      const was = stored.get(i.id);
      if (i.kind === "farmer") (i as Farmer).awaiting = was?.kind === "farmer" ? was.awaiting : undefined;
    }
    // Inputs handed out: the farmer stays at "distribute" until the project manager approves
    // (server/distribution moves them on), the same as a distribution from KoboCollect.
    const handedOut = items.filter((i): i is Farmer => i.kind === "farmer" && before.get(i.id) === "distribute" && i.step === "plant");
    const toSave = items.map((i) => (handedOut.includes(i as Farmer) ? { ...i, step: "distribute" } : i));
    const revs = toSave.length ? await saveEdited(code, toSave) : {};
    const recorded: string[] = [];
    for (const f of handedOut) recorded.push(await recordFromApp(code, f, v.user, new URL(req.url).origin));
    // Planting recorded: when the project's target counts at planting, the farmer counts toward it now.
    const results: string[] = [];
    for (const i of items)
      if (i.kind === "farmer" && before.get(i.id) === "plant" && i.step === "complete") {
        const r = await countPlanting(code, i, v.user);
        if (r) results.push(r);
      }
    // The store's stock follows the purchases when they supply the package; a typed figure is kept only when none does.
    const derived = await stockFor(code);
    const typed = body.stock && !derived ? body.stock : undefined;
    if (typed) await saveStock(code, typed);
    if (items.length || typed)
      await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_saved", by: v.user.id, detail: { items: items.map((i) => ({ id: i.id, kind: i.kind, step: i.step })), ...(typed ? { stock: typed } : {}), ...(recorded.length ? { distributions: recorded } : {}), ...(results.length ? { results } : {}) } });
    return NextResponse.json({ ok: true, revs, distributions: recorded, results, ...(derived ? { stock: derived.stock, stockNote: derived.block } : {}) });
  });
}
