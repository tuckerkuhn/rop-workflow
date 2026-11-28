import { AGE_BANDS } from "@/lib/field";
import { maySupplyProof } from "@/server/farmer-photo";
import { NextResponse } from "next/server";
import { stampHistory } from "@/lib/history";
import { PHOTO_MAX_CHARS } from "@/lib/plans";
import { z } from "zod";
import { docLinksSchema } from "@/lib/doc-links";
import type { FieldItem } from "@/lib/field";
import { requireViewer } from "@/server/auth";
import { keepHidden, loadField, saveEdited, saveStock } from "@/server/field-store";
import { stockFor } from "@/server/distribution";
import { addsSignedNote, afterTrainInputs, handRecordProblem, moveProblem, stepRefusal, type Farmer } from "@/lib/field";
import { today } from "@/lib/clock";
import { projectByCode } from "@/server/field-store";
import { selectionOutcomes } from "@/server/selection-store";
import { selectionHold } from "@/lib/selection";
import { audit, handle, HttpError, readBody } from "@/server/guard";

/**
 * Field activities state for a project. Names are included only for roles allowed to see them.
 * `selection`: each decided farmer's selection outcome by number, or null when the project does not
 * use selection; the page keeps waitlisted farmers and those who did not qualify out of the queue.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.fieldAccess !== "none" });
    if (v instanceof NextResponse) return v;
    const field = await loadField(code, v.user);
    // One figure for the store: what purchases have received less what has been handed out.
    // A project with no purchase for the package keeps the stock typed in Field activities.
    const [derived, selection] = await Promise.all([stockFor(code), projectByCode(code).then((p) => selectionOutcomes(p.id))]);
    return NextResponse.json({ ...field, stock: derived?.stock ?? field.stock, stockFrom: derived ? "purchases" : "store", stockNote: derived?.block ?? null, selection });
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
  ageBand: z.enum(AGE_BANDS),
  householdSize: z.number().int().min(0).max(100),
  household: z.array(z.object({ sex: z.enum(["Female", "Male"]), age: z.number().int().min(0).max(120) })).max(100).optional(),
  community: short,
  hectares: z.number().min(0).max(100000),
  enrolled: z.boolean(),
  enrolledOn: short,
  contributionPaid: z.boolean(),
  deadline: short.optional(),
  correction: z.string().max(4000).optional(),
  surveys: z.array(z.looseObject({ date: short, score: z.number(), comment: z.string().max(4000), by: short })).max(200),
  photos: z.array(z.looseObject({ id: short, activity: z.enum(["training", "landprep", "visit", "distribution", "planting"]), date: short, caption: z.string().max(1000), src: z.string().max(PHOTO_MAX_CHARS).optional() })).max(200),
  stories: z.array(z.looseObject({ id: short, status: z.enum(["note", "completed"]), title: short, text: z.string().max(20000), date: short, by: short, docs: docLinksSchema.optional() })).max(100),
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

/**
 * Saves changed items and/or the store stock. Field steps are not entered here: they come from
 * KoboCollect (lib/field handRecordProblem). What is saved is the project manager's remove-or-extend
 * decision, MEL findings, issues, and notes on a farmer's record.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" && u.fieldAccess === "edit", why: "You can view Field activities but not change them." });
    if (v instanceof NextResponse) return v;
    const body = await readBody(req, bodySchema, "That record is not complete, so it was not saved. Reload the page and try again.");
    const sent: FieldItem[] = body.items ?? [];
    const field = await loadField(code, v.user);
    const stored = new Map(field.items.map((i) => [i.id, i]));
    // What was hidden from this person (the farmer's name in text and links) is kept, from the records as stored.
    const raw = new Map((await loadField(code)).items.map((i) => [i.id, i]));
    const items = await keepHidden(code, v.user, sent, raw);
    const before = new Map(field.items.map((i) => [i.id, i.step]));
    // A stale page never writes over newer work: each record must be the version the page read.
    const stale = items.find((i) => stored.has(i.id) && stored.get(i.id)!.rev !== i.rev);
    if (stale) throw new HttpError(409, `${stale.kind === "farmer" ? `Farmer ${stale.id}` : `Finding ${stale.id}`} was changed by someone else since you opened this page, so your change was not saved. The page now shows the latest; make your change again.`);
    // The photo of the signed goods received note is proof of a distribution: only the people who hand
    // goods out may add one (server/farmer-photo maySupplyProof), whatever the page offered. A photo
    // already on the record is left as it is.
    if (!maySupplyProof(v.user)) {
      const proof = items.find((i) => i.kind === "farmer" && addsSignedNote(raw.get(i.id) as Farmer | undefined, i));
      if (proof) throw new HttpError(403, "The photo of the signed goods received note is added by the storekeeper or the extension agent, so that nobody who checks or approves a distribution also supplies its proof. Add it under another tag, or ask the storekeeper.");
    }
    // Field steps come from KoboCollect: ticking a check, moving a step or entering planting by hand is refused.
    const byHand = items.map((i) => handRecordProblem(raw.get(i.id), i)).find(Boolean);
    if (byHand) return NextResponse.json({ error: byHand }, { status: 409 });
    // A farmer moves only along the workflow, from the step the database holds (lib/field moveProblem),
    // by the step's owner, with its checks done (stepRefusal): the screen's rules, enforced here.
    const derivedBefore = await stockFor(code);
    const ctx = { stock: derivedBefore?.stock ?? field.stock ?? {}, stockNote: derivedBefore?.block ?? null, setup: field.setup ?? { items: [] }, today: today() };
    const wrong = items.map((i) => moveProblem(before.get(i.id), i) ?? (raw.has(i.id) ? stepRefusal(raw.get(i.id)!, i, v.user.field, ctx) : null)).find(Boolean);
    if (wrong) return NextResponse.json({ error: wrong }, { status: 409 });
    // Server-owned: whether a distribution waits for approval is never taken from the page.
    for (const i of items) {
      const was = raw.get(i.id);
      if (i.kind === "farmer") (i as Farmer).awaiting = was?.kind === "farmer" ? was.awaiting : undefined;
    }
    // Each new history entry gets the time it was saved; older ones keep theirs (lib/history).
    const now = new Date();
    // Enrolment and the contribution are recorded here (no KoboCollect form asks them): a farmer whose
    // training KoboCollect already recorded moves on to Prepare the plot once nothing holds them at
    // Train, never while waitlisted or left out in Farmer selection (lib/field afterTrainInputs).
    const outcomes = await selectionOutcomes((await projectByCode(code)).id);
    const toSave = items.map((i) => afterTrainInputs(raw.get(i.id), i, ctx.today, selectionHold(outcomes, i.id))).map((i) => ({ ...i, timeline: stampHistory(raw.get(i.id)?.timeline, i.timeline ?? [], now) }) as FieldItem);
    const revs = toSave.length ? await saveEdited(code, toSave) : {};
    // The store's stock follows the purchases when they supply the package; a typed figure is kept only when none does.
    const derived = await stockFor(code);
    const typed = body.stock && !derived ? body.stock : undefined;
    if (typed) await saveStock(code, typed);
    if (items.length || typed)
      await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_saved", by: v.user.id, detail: { items: items.map((i) => ({ id: i.id, kind: i.kind, step: i.step })), ...(typed ? { stock: typed } : {}) } });
    return NextResponse.json({ ok: true, revs, ...(derived ? { stock: derived.stock, stockNote: derived.block } : {}) });
  });
}
