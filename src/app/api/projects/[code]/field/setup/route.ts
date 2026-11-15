import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { FIELD_SETUP_KEY, setupProblem, type FieldSetup } from "@/lib/package";
import { requireViewer } from "@/server/auth";
import { projectByCode, setupOf } from "@/server/field-store";
import { audit, handle, readBody } from "@/server/guard";
import { loadBudget } from "@/server/plan-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";

type Ctx = { params: Promise<{ code: string }> };

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
});

/** Saves the package. From then on the project has Field activities. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) && u.kind === "employee", why: "Only the project manager and plan approvers can set up the input package." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "The package could not be saved: check each item has a name, unit, amount and budget line.");
    const setup: FieldSetup = { ...b, windowEnd: b.windowEnd || undefined };
    const problem = setupProblem(setup);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const budget = await loadBudget(code).catch(() => null);
    const known = new Set(budget?.lines.map((l) => l.code) ?? []);
    const unknown = known.size ? setup.items.find((i) => !known.has(i.budgetLine)) : undefined;
    if (unknown) return NextResponse.json({ error: `${unknown.item}: budget line ${unknown.budgetLine} is not in this project's budget.` }, { status: 400 });
    const project = await projectByCode(code);
    const before = await setupOf(project);
    await saveProjectState(project.id, FIELD_SETUP_KEY, setup);
    await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_setup_saved", by: v.user.id, detail: { before: before?.items ?? null, after: setup.items } });
    return NextResponse.json({ setup });
  });
}
