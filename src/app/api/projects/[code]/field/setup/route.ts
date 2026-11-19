import { NextResponse } from "next/server";
import { countApprovedDistributions } from "@/server/distribution";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { canEditProject } from "@/lib/demo";
import { FIELD_SETUP_KEY, setupProblem, type FieldSetup } from "@/lib/package";
import { requireViewer } from "@/server/auth";
import { projectByCode, setupOf } from "@/server/field-store";
import { audit, handle, readBody } from "@/server/guard";
import { loadBudget } from "@/server/plan-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";

type Ctx = { params: Promise<{ code: string }> };

const resultTargets = (projectId: string) =>
  db
    .select({ code: s.indicators.code, name: s.indicators.name, unit: s.indicators.unit })
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.source, "results")))
    .orderBy(asc(s.indicators.position));

/**
 * A project's input package and season for Field activities (lib/package). GET also gives the
 * budget lines to choose from and any draft waiting to be confirmed.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.fieldAccess !== "none" || canEditProject(u) });
    if (v instanceof NextResponse) return v;
    const project = await projectByCode(code);
    const stored = await loadProjectState<(FieldSetup & { draft?: boolean }) | null>(project.id, FIELD_SETUP_KEY, null);
    const budget = await loadBudget(code).catch(() => ({ lines: [] as { code: string; description: string; unit: string }[] }));
    return NextResponse.json({
      setup: await setupOf(project),
      draft: stored?.draft ? stored : null,
      lines: budget.lines.map((l) => ({ code: l.code, description: l.description, unit: l.unit })),
      // The targets an approved distribution can count toward: the ones that take recorded results.
      targets: await resultTargets(project.id),
      canEdit: canEditProject(v.user) && v.user.kind === "employee",
    });
  });
}

const item = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
  item: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(40),
  qty: z.number().positive().max(1e7),
  per: z.enum(["farmer", "hectare"]),
  budgetLine: z.string().trim().min(1).max(60),
  unitUsd: z.number().min(0).max(1e7).optional(),
});
const body = z.object({
  items: z.array(item).min(1).max(20),
  season: z.string().trim().max(80).optional(),
  village: z.string().trim().max(80).optional(),
  crop: z.string().trim().max(80).optional(),
  windowEnd: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  target: z.union([z.string().regex(/^IND-\d+$/), z.literal("")]).optional(),
  targetAt: z.enum(["distribution", "planting"]).optional(),
});

/** Saves the package. From then on the project has Field activities. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) && u.kind === "employee", why: "Only the project manager and plan approvers can set up the input package." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "The package could not be saved: check each item has a name, unit, amount and budget line.");
    const setup: FieldSetup = { ...b, windowEnd: b.windowEnd || undefined, target: b.target || undefined, targetAt: b.target && b.targetAt === "planting" ? "planting" : undefined };
    const problem = setupProblem(setup);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const budget = await loadBudget(code).catch(() => null);
    const known = new Set(budget?.lines.map((l) => l.code) ?? []);
    const unknown = known.size ? setup.items.find((i) => !known.has(i.budgetLine)) : undefined;
    if (unknown) return NextResponse.json({ error: `${unknown.item}: budget line ${unknown.budgetLine} is not in this project's budget.` }, { status: 400 });
    const project = await projectByCode(code);
    const takes = await resultTargets(project.id);
    if (setup.target && !takes.some((i) => i.code === setup.target)) return NextResponse.json({ error: "That target is not one of this project's targets that take recorded results." }, { status: 400 });
    const before = await setupOf(project);
    await saveProjectState(project.id, FIELD_SETUP_KEY, setup);
    await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_setup_saved", by: v.user.id, detail: { before: before?.items ?? null, after: setup.items, target: { before: before?.target ?? null, after: setup.target ?? null }, targetAt: { before: before?.targetAt ?? "distribution", after: setup.targetAt ?? "distribution" } } });
    // A target named now (or now counted at planting) also counts what is already recorded: the
    // approved distributions, or the recorded plantings (server/distribution). Never twice.
    const counted = setup.target && (setup.target !== before?.target || setup.targetAt !== before?.targetAt) ? await countApprovedDistributions(code, setup.target) : 0;
    return NextResponse.json({ setup, counted });
  });
}
