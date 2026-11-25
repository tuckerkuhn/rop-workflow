import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { termSchema } from "@/lib/agreement";
import { mergeObligations, obligationInputSchema } from "@/lib/obligations";
import { canEditProject } from "@/lib/demo";
import { paramByKey } from "@/lib/policy";
import { personName } from "@/lib/project";
import { fits } from "@/lib/presets";
import { logAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { loadObligations, projectDonors, saveObligations } from "@/server/obligations-store";
import { loadPolicy, savePolicy } from "@/server/policy-store";
import { createWorkItem, listWorkItems, setNotes } from "@/server/work-store";

/**
 * Saves what a person confirmed from the agreement in setup (lib/agreement): report deadlines as
 * "Report deadline" milestones in Tasks, and rules into the project's "From the agreement" policy
 * layer, each with its source. The obligations themselves are kept per donor (lib/obligations), so
 * each donor's report periods, deadlines and asked-for format follow its agreement. Programme
 * leads and administrators; every confirmation is logged.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const value = z.union([z.number(), z.boolean(), z.string().max(300), z.array(z.string().max(200)).max(30)]);
const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("deadlines"),
    /** `donorId`: the donor the deadline's report goes to; left out, the project's only donor. */
    items: z.array(z.object({ title: z.string().trim().min(2).max(200), date: day, source: z.string().max(200), donorId: z.uuid().nullable().optional() })).max(200),
    /** The reporting obligations as confirmed, each with its donor (project_state "obligations"). */
    obligations: z.array(obligationInputSchema).max(40).optional(),
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
      // Each report goes to one donor: the one the person picked, else the project's only donor.
      const donors = await projectDonors(project.id);
      const ids = new Set(donors.map((d) => d.id));
      const stranger = [...a.items.map((d) => d.donorId), ...(a.obligations ?? []).map((o) => o.donorId)].find((id) => id && !ids.has(id));
      if (stranger) return NextResponse.json({ error: "That donor is not on this project. Choose one of the project's donors." }, { status: 400 });
      const donorOf = (id: string | null | undefined) => id ?? (donors.length === 1 ? donors[0].id : null);

      // Twice-confirmed deadlines are not added twice; one saved before it had a donor gets its donor now.
      const milestones = (await listWorkItems(code)).items.filter((i) => i.type === "milestone");
      let added = 0;
      for (const d of a.items) {
        const donorId = donorOf(d.donorId);
        const same = milestones.filter((i) => i.title === d.title && i.date === d.date && (!i.donorId || !donorId || i.donorId === donorId));
        if (same.length) {
          const bare = same.find((i) => !i.donorId);
          if (donorId && bare && !same.some((i) => i.donorId === donorId)) {
            await db.update(s.workItems).set({ donorId, updatedAt: new Date() }).where(and(eq(s.workItems.id, bare.id), eq(s.workItems.projectId, project.id), isNull(s.workItems.donorId)));
            bare.donorId = donorId;
          }
          continue;
        }
        const w = await createWorkItem(code, { type: "milestone", title: d.title, date: d.date, endDate: null, milestoneKind: "report_deadline" }, v.actor.id, donorId);
        if (d.source) await setNotes(code, w.id, `From the agreement: ${d.source}. Confirmed by ${by} in setup.`);
        milestones.push(w);
        added++;
      }
      const confirmed = (a.obligations ?? []).map((o) => ({ ...o, donorId: donorOf(o.donorId), by: v.actor.id, at }));
      if (confirmed.length) await saveObligations(project.id, mergeObligations(await loadObligations(project.id), confirmed));
      for (const r of a.rules) layer.values[r.key] = { value: r.value, source: r.source, by, at };
      await savePolicy(code, { ...setting, agreement: layer });
      const obligations = confirmed.map((o) => ({ donorId: o.donorId, report: o.report, name: o.name, frequency: o.frequency, periodEnds: o.periodEnds, daysAfter: o.daysAfter, format: o.format, source: o.source }));
      await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "agreement_deadlines_confirmed", by: v.actor.id, detail: { added, skipped: a.items.length - added, rules: a.rules, obligations, file: a.file ?? null } });
      return NextResponse.json({ added, obligations: confirmed.length });
    }

    const bad = a.values.filter((x) => !paramByKey[x.key]).map((x) => x.key);
    if (bad.length) return NextResponse.json({ error: `Not a policy setting: ${bad.join(", ")}.` }, { status: 400 });
    // A value must be the kind its rule takes (a number for a threshold, yes or no for a requirement), as in Settings.
    const unfit = a.values.find((x) => !fits(paramByKey[x.key], x.value));
    if (unfit) return NextResponse.json({ error: `${paramByKey[unfit.key].label}: that value does not fit this rule. Correct it, or leave the rule out.` }, { status: 400 });
    for (const x of a.values) layer.values[x.key] = { value: x.value, source: x.source, by, at };
    const known = new Set(layer.terms.map((x) => x.text));
    for (const x of a.terms) if (!known.has(x.text)) layer.terms.push({ ...x, by, at });
    await savePolicy(code, { ...setting, agreement: layer });
    await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "agreement_rules_confirmed", by: v.actor.id, detail: { values: a.values.map((x) => ({ key: x.key, value: x.value, source: x.source })), terms: a.terms.length, file: a.file ?? null } });
    return NextResponse.json({ saved: a.values.length, terms: a.terms.length });
  });
}
