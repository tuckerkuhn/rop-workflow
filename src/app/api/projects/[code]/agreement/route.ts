import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { termSchema } from "@/lib/agreement";
import { canEditProject } from "@/lib/demo";
import { paramByKey } from "@/lib/policy";
import { personName } from "@/lib/project";
import { logAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { loadPolicy, savePolicy } from "@/server/policy-store";
import { createWorkItem, listWorkItems, setNotes } from "@/server/work-store";

/**
 * Saves what a person confirmed from the agreement in setup (lib/agreement): report deadlines as
 * "Report deadline" milestones in Tasks, and rules into the project's "From the agreement" policy
 * layer, each with its source. Programme leads and administrators; every confirmation is logged.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const value = z.union([z.number(), z.boolean(), z.string().max(300), z.array(z.string().max(200)).max(30)]);
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("deadlines"),
    items: z.array(z.object({ title: z.string().trim().min(2).max(200), date: day, source: z.string().max(200) })).max(200),
    /** The days-after-period rules the obligations give, for pre-flight's deadline (lib/agreement reportDaysRule). */
    rules: z.array(z.object({ key: z.enum(["quarterlyReportDays", "annualReportDays"]), value: z.number().int().min(0).max(365), source: z.string().max(200) })).max(2),
    file: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("rules"),
    values: z.array(z.object({ key: z.string(), value, source: z.string().max(200) })).max(60),
    terms: z.array(termSchema).max(30),
    file: z.string().max(200).optional(),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) || !!u.admin, why: "Only programme leads and administrators confirm what the agreement says." });
    if (v instanceof NextResponse) return v;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const project = await projectByCode(code);
    const by = personName(v.actor.id);
    const at = new Date().toISOString();
    const setting = await loadPolicy(code);
    const layer = setting.agreement ?? { values: {}, terms: [] };
    if (a.file) layer.file = a.file;

    if (a.action === "deadlines") {
      // Twice-confirmed deadlines are not added twice.
      const have = new Set((await listWorkItems(code)).items.filter((i) => i.type === "milestone").map((i) => `${i.title}|${i.date}`));
      let added = 0;
      for (const d of a.items) {
        if (have.has(`${d.title}|${d.date}`)) continue;
        const w = await createWorkItem(code, { type: "milestone", title: d.title, date: d.date, endDate: null, milestoneKind: "report_deadline" }, v.actor.id);
        if (d.source) await setNotes(code, w.id, `From the agreement: ${d.source}. Confirmed by ${by} in setup.`);
        have.add(`${d.title}|${d.date}`);
        added++;
      }
      for (const r of a.rules) layer.values[r.key] = { value: r.value, source: r.source, by, at };
      await savePolicy(code, { ...setting, agreement: layer });
      await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "agreement_deadlines_confirmed", by: v.actor.id, detail: { added, skipped: a.items.length - added, rules: a.rules, file: a.file ?? null } });
      return NextResponse.json({ added });
    }

    const bad = a.values.filter((x) => !paramByKey[x.key]).map((x) => x.key);
    if (bad.length) return NextResponse.json({ error: `Not a policy setting: ${bad.join(", ")}.` }, { status: 400 });
    for (const x of a.values) layer.values[x.key] = { value: x.value, source: x.source, by, at };
    const known = new Set(layer.terms.map((x) => x.text));
    for (const x of a.terms) if (!known.has(x.text)) layer.terms.push({ ...x, by, at });
    await savePolicy(code, { ...setting, agreement: layer });
    await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "agreement_rules_confirmed", by: v.actor.id, detail: { values: a.values.map((x) => ({ key: x.key, value: x.value, source: x.source })), terms: a.terms.length, file: a.file ?? null } });
    return NextResponse.json({ saved: a.values.length, terms: a.terms.length });
  });
}
