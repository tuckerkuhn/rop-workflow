/**
 * One-off: puts ACRP-2026's indicators on the official targets and links them to the workplan.
 *
 * Official = the signed RPA (8 Mar 2025, Annex C(a): 2025 targets) and Amendment No. 1
 * (31 Dec 2025, Annex B.1, the technical proposal of 15 Nov 2025: 2026 and 2027 targets).
 * UNDP's email approvals of budget realignments are not amendments, so they change no target.
 * Choices where the documents disagree: trellis in jerib (B.1); watershed training 160 for the
 * phase (B.1, not B.2's 180); planting 13 ha (the revised budgets' 57 is a budget, not a target).
 *
 * Needs migration 0021 (workplan_code, in_quarterly_report). Dry run by default:
 *   npx tsx --env-file=.env.local src/db/acrp-official-targets.ts           (shows the changes)
 *   npx tsx --env-file=.env.local src/db/acrp-official-targets.ts --apply   (makes them)
 * Touches only ACRP-2026's indicators: no results, files or report text.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";

const CODE = "ACRP-2026";

/** Targets per year: [2025, 2026, 2027]. Stored as running totals; the whole agreement is the sum. */
const OFFICIAL: Record<string, [number, number, number]> = {
  "IND-1": [3, 8, 5], // 1.1.1.2 quality planting material (ha)
  "IND-2": [30, 44, 22], // 1.1.1.3 trellising (jerib)
  "IND-3": [0, 10, 10], // 1.1.1.4 drip irrigation (ha)
  "IND-4": [20, 30, 0], // 1.1.1.5 commercial greenhouses
  "IND-5": [6, 6, 4], // 1.2.1.2 SMEs with business plans, incubation, matching grants
  "IND-6": [1, 3, 0], // 1.2.1.3 post-harvest facilities
  "IND-7": [130, 190, 100], // 1.2.1.4 trained in post-harvest handling
  "IND-8": [0, 44, 22], // 1.2.1.6 off-farm jobs (MSMEs)
  "IND-9": [1, 2, 1], // 1.2.2.2 market infrastructure, per province
  "IND-11": [3, 6, 2], // 1.2.2.5 domestic exhibitions
  "IND-12": [2, 2, 2], // 1.2.2.6 international exhibitions
  "IND-13": [4, 2, 0], // 2.1.1.1-a IWRM plans
  "IND-14": [0, 2, 2], // 2.1.1.1-b soil and water conservation (ha)
  "IND-15": [0, 2, 2], // 2.1.1.1-c CSA demonstration plots (ha)
  "IND-16": [50, 100, 60], // 2.1.2.1-a watershed / water-use training
  "IND-17": [0, 12, 4], // 2.1.2.1-b Water Users Associations
};

/** Official wording where the app's differs. */
const RENAME: Record<string, { name: string; unit: string }> = {
  "IND-5": { name: "SMEs supported with business plans, business incubation and matching grants", unit: "facilities" },
  "IND-9": { name: "Market infrastructure restored (per province)", unit: "facilities" },
};

/** The community-level market sheds indicator (B.1), missing from the app. */
const NEW = { code: "IND-19", donorCode: "1.2.2.4", name: "Community-level market sheds restored", unit: "facilities", targets: [0, 6, 2] as [number, number, number], after: "IND-9" };

/** Workplan activity (ROP's rows) for each indicator. Drip irrigation has no workplan row. */
const WORKPLAN: Record<string, string> = {
  "IND-1": "1.1.1.2",
  "IND-2": "1.1.1.2",
  "IND-18": "1.1.1.2",
  "IND-4": "1.1.1.3",
  "IND-5": "1.2.1.2",
  "IND-6": "1.2.1.3",
  "IND-7": "1.2.1.4",
  "IND-8": "1.2.1.6",
  "IND-9": "1.2.2.2",
  "IND-19": "1.2.2.2",
  "IND-11": "1.2.2.4",
  "IND-12": "1.2.2.4",
  "IND-13": "2.1.1.1",
  "IND-14": "2.1.1.1",
  "IND-15": "2.1.1.1",
  "IND-16": "2.1.2.1",
  "IND-17": "2.1.2.1",
};

/** Tracked for UNDP's annual report, not in ROP's agreement: kept, but out of the quarterly table. */
const NOT_QUARTERLY = ["IND-18"];

const totals = ([a, b, c]: [number, number, number]) => ({ forecast: { "2025": a, "2026": a + b }, target: a + b + c });

async function main() {
  const apply = process.argv.includes("--apply");
  const [project] = await db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.code, CODE));
  if (!project) throw new Error(`No project ${CODE}`);
  const rows = await db
    .select({ code: s.indicators.code, name: s.indicators.name, unit: s.indicators.unit, target: s.indicators.target, forecast: s.indicators.forecast, position: s.indicators.position })
    .from(s.indicators)
    .where(eq(s.indicators.projectId, project.id));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const c of [...Object.keys(OFFICIAL), ...Object.keys(WORKPLAN).filter((c) => c !== NEW.code), ...NOT_QUARTERLY]) if (!byCode.has(c)) throw new Error(`${CODE} has no indicator ${c}`);

  console.log(apply ? "Applying:" : "Dry run (add --apply to make these changes):");
  for (const [code, t] of Object.entries(OFFICIAL)) {
    const r = byCode.get(code)!;
    const next = totals(t);
    const ren = RENAME[code];
    console.log(`  ${code}: target ${Number(r.target)} -> ${next.target}; by year ${JSON.stringify(r.forecast)} -> ${JSON.stringify(next.forecast)}${ren ? `; "${r.name}" (${r.unit}) -> "${ren.name}" (${ren.unit})` : ""}; workplan ${WORKPLAN[code] ?? "none"}`);
  }
  console.log(byCode.has(NEW.code) ? `  ${NEW.code} exists already: targets and link updated only.` : `  add ${NEW.code} ${NEW.donorCode} "${NEW.name}": target ${totals(NEW.targets).target}, by year ${JSON.stringify(totals(NEW.targets).forecast)}, after ${NEW.after}; workplan ${WORKPLAN[NEW.code]}`);
  for (const c of NOT_QUARTERLY) console.log(`  ${c}: kept, left out of the quarterly report; workplan ${WORKPLAN[c]}`);
  if (!apply) return;

  await db.transaction(async (tx) => {
    const where = (code: string) => and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, code));
    for (const [code, t] of Object.entries(OFFICIAL)) {
      const { forecast, target } = totals(t);
      await tx.update(s.indicators).set({ target: String(target), forecast, ...RENAME[code], workplanCode: WORKPLAN[code] ?? null, updatedAt: new Date() }).where(where(code));
    }
    if (!byCode.has(NEW.code)) {
      const [model] = await tx.select().from(s.indicators).where(where(NEW.after));
      // Make room right after the provincial market indicator.
      await tx
        .update(s.indicators)
        .set({ position: sql`${s.indicators.position} + 1` })
        .where(and(eq(s.indicators.projectId, project.id), gt(s.indicators.position, model.position)));
      const { forecast, target } = totals(NEW.targets);
      await tx.insert(s.indicators).values({
        projectId: project.id,
        code: NEW.code,
        donorCode: NEW.donorCode,
        name: NEW.name,
        unit: NEW.unit,
        target: String(target),
        forecast,
        level: model.level,
        result: model.result,
        source: model.source,
        frequency: model.frequency,
        theme: model.theme,
        disaggregation: model.disaggregation,
        verification: model.verification,
        budgetRef: model.budgetRef,
        workplanCode: WORKPLAN[NEW.code],
        position: model.position + 1,
      });
    } else {
      const { forecast, target } = totals(NEW.targets);
      await tx.update(s.indicators).set({ target: String(target), forecast, workplanCode: WORKPLAN[NEW.code], updatedAt: new Date() }).where(where(NEW.code));
    }
    for (const c of NOT_QUARTERLY) await tx.update(s.indicators).set({ inQuarterlyReport: false, workplanCode: WORKPLAN[c], updatedAt: new Date() }).where(where(c));
  });
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
