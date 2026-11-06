/**
 * One-off: corrects three ACRP-2026 results copied from the annual report with a stand-in date
 * (18 Sep 2026, the end of that report's period). The Q4 2025 quarterly report sent to UNDP on
 * 9 Jan 2026 ("ACRP_QPR_October - December 2025.docx") shows when and where each happened:
 * - 118 women trained in post-harvest handling: Kandahar City, Dec 2025 (Fig. 4, 11 Dec 2025);
 *   its table gives Q4 118, year 248 (= Year 1's 130 + 118).
 * - "18 more men" trained in water use: in fact 18 women, Kandahar, Dec 2025 (Fig. 8, 14 Dec 2025);
 *   its table gives Q4 18, year 78 (= Year 1's 60 + 18).
 * - Three refrigerated containers at Al Sadat Sabzi Market, Grishk: installed by 29 Dec 2025
 *   (Fig. 3); its table gives 1.2.1.3 Q4 1, year 1.
 * And four more the Q4 2025 report counts in 2025 without a source date (dated from the report,
 * not from a document; the pilot does not ask the field team to reconstruct them):
 * - Business plans for Faiz Gulab Ltd. and KFPC: its table gives 1.2.1.2 Q4 0, year 6 (= Year 1's
 *   4 + these 2), so they were done before Q4: dated 30 Sep 2025.
 * - IWRM plans for Musa Qala and Sangin: 2.1.1.1 Q4 0, year 4 (= Year 1's 2 + these 2): 30 Sep 2025.
 * - Market shed at Al Sadat Sabzi Market, Grishk: 1.2.2.2 Q4 1, year 1, with the canopy photo of
 *   29 Dec 2025: dated 29 Dec 2025.
 * Each stays waiting for MEL review: only the date, place, women/men and note change.
 *
 * Dry run by default:
 *   npx tsx --env-file=.env.local src/db/acrp-fix-annual-report-results.ts           (shows the changes)
 *   npx tsx --env-file=.env.local src/db/acrp-fix-annual-report-results.ts --apply   (makes them)
 * A record is changed only if it still has the stand-in date and the expected value, so running it twice does nothing.
 */
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { ResultInput } from "@/lib/results";

const CODE = "ACRP-2026";
const STAND_IN = "2026-09-18";
const Q4_2025 = "Reported in the Q4 2025 quarterly report to UNDP (ACRP_QPR_October - December 2025.docx, sent 9 Jan 2026)";

type Fix = { id: string; indicator: string; value: number; set: Partial<ResultInput> };

const FROM_REPORT = "date taken from the report's 2025 total; no source document";

const FIXES: Fix[] = [
  {
    id: "4318384d-b961-44cc-ac09-4509970b2f51",
    indicator: "IND-7",
    value: 118,
    set: {
      date: "2025-12-11",
      female: 118,
      male: 0,
      province: "Kandahar",
      district: "Kandahar City",
      note: "118 women trained in post-harvest handling with women-led agribusinesses and producer groups in Kandahar City, December 2025.",
      noFile: `${Q4_2025}, Fig. 4 (11 Dec 2025); attendance sheets to attach`,
    },
  },
  {
    id: "8e7f9188-4d03-4445-b941-4b0e822e32da",
    indicator: "IND-16",
    value: 18,
    set: {
      date: "2025-12-14",
      female: 18,
      male: 0,
      province: "Kandahar",
      note: "18 women trained in water-use efficiency in Kandahar, December 2025. (The annual report's \"18 more men\" is corrected: the Q4 2025 report counts 18 women.)",
      noFile: `${Q4_2025}, Fig. 8 (14 Dec 2025); attendance sheets to attach`,
    },
  },
  {
    id: "93a19a14-52bc-49f1-ac43-08cdf793835a",
    indicator: "IND-6",
    value: 1,
    set: {
      date: "2025-12-29",
      province: "Helmand",
      district: "Grishk",
      note: "Three refrigerated containers of about 25 metric tons each installed, fenced, at Al Sadat Sabzi Market, Grishk, through the grant programme, by 29 December 2025.",
      noFile: `${Q4_2025}, Fig. 3 (29 Dec 2025); completion report to attach`,
    },
  },
  {
    id: "e17b4e74-2d1d-499b-aa29-1ffe066e08d8",
    indicator: "IND-5",
    value: 1,
    set: { date: "2025-09-30", province: "Kandahar", note: "Business plan developed for Faiz Gulab Ltd., Kandahar, in 2025.", noFile: `${Q4_2025}: 6 business plans in 2025; ${FROM_REPORT}` },
  },
  {
    id: "bd19c4a4-330f-4054-b51a-17e8a9feda1d",
    indicator: "IND-5",
    value: 1,
    set: { date: "2025-09-30", province: "Kandahar", note: "Business plan developed for Kandahar Food Processing Center (KFPC) in 2025.", noFile: `${Q4_2025}: 6 business plans in 2025; ${FROM_REPORT}` },
  },
  {
    id: "3e07010e-b85a-4980-b8bd-85fff9fe597d",
    indicator: "IND-13",
    value: 2,
    set: { date: "2025-09-30", province: "Helmand", note: "Community-based IWRM plans for Musa Qala and Sangin, covering about 4,690 hectares and 7,874 people, in 2025.", noFile: `${Q4_2025}: 4 IWRM plans in 2025; ${FROM_REPORT}` },
  },
  {
    id: "b7e05d22-be59-4f74-9d58-7c79632ca538",
    indicator: "IND-9",
    value: 1,
    set: {
      date: "2025-12-29",
      province: "Helmand",
      district: "Grishk",
      note: "Market shed at Al Sadat Sabzi Market, Grishk: 1,000 m² canopy and 1,000 m² concrete floor, serving over 100 traders and about 300-400 farmers; counted as completed in Q4 2025.",
      noFile: `${Q4_2025}, Fig. 5 (canopy, 29 Dec 2025); completion report to attach`,
    },
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const [project] = await db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.code, CODE));
  if (!project) throw new Error(`No project ${CODE}`);
  console.log(apply ? "Applying:" : "Dry run (add --apply to make these changes):");

  const todo: { fix: Fix; payload: ResultInput }[] = [];
  for (const fix of FIXES) {
    const [row] = await db
      .select({ payload: s.evidence.payload, status: s.evidence.reviewStatus })
      .from(s.evidence)
      .where(and(eq(s.evidence.id, fix.id), eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result")));
    if (!row) throw new Error(`${fix.indicator}: record ${fix.id} not found`);
    const p = row.payload as ResultInput;
    if (p.indicator !== fix.indicator || p.value !== fix.value) throw new Error(`${fix.indicator}: record ${fix.id} is not the expected one (${p.indicator}, ${p.value})`);
    if (p.date !== STAND_IN) {
      console.log(`  ${fix.indicator} ${fix.value}: already corrected (dated ${p.date}); skipped.`);
      continue;
    }
    const next = { ...p, ...fix.set };
    console.log(`  ${fix.indicator} ${fix.value} (${row.status}): ${p.date} -> ${next.date}; place ${[p.district, p.province].filter(Boolean).join(", ") || "none"} -> ${[next.district, next.province].filter(Boolean).join(", ")}; women/men ${p.female ?? "-"}/${p.male ?? "-"} -> ${next.female ?? "-"}/${next.male ?? "-"}`);
    todo.push({ fix, payload: next });
  }
  if (!apply || !todo.length) return;

  await db.transaction(async (tx) => {
    for (const { fix, payload } of todo)
      await tx
        .update(s.evidence)
        .set({
          payload,
          completedAt: new Date(`${payload.date}T12:00:00Z`),
          location: [payload.district, payload.province].filter(Boolean).join(", ") || null,
          updatedAt: new Date(),
        })
        .where(and(eq(s.evidence.id, fix.id), eq(s.evidence.projectId, project.id)));
  });
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
