import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { realToday } from "@/lib/clock";
import { DONOR_FUNDING_KEY, type DonorFundingBook } from "@/lib/donor-funding";
import { emptyQpr, type Qpr } from "@/lib/qpr";
import { quarterOf } from "@/lib/results";
import { saveProjectState } from "@/server/project-state";
import { addCopy, copyOf, qprData, reportWork, saveQpr } from "@/server/qpr-store";

/**
 * What a donor opens on the demo project: a released quarterly report and what each grant pays for.
 *
 * Without these a donor's account on the demo shows "no report released yet" and no money: the
 * release is refused while the report check lists a blocker, so releasing on stage is fragile, and
 * with two donors nothing about money shows until someone says what each funds.
 *
 * The report is the last quarter that has ended, and only once the project has run through one: a
 * report for a quarter still under way could not exist. Loaded on 20 November 2026 there is none
 * (the project starts on 1 October); loaded on the morning of the demo it is 2026-Q4. Its figures
 * are the demo's own accepted results, frozen as a real release freezes them.
 */

/** Who "released" it: no real person. */
export const DEMO_REPORT_BY = "demo";

/** The quarter before the one `today` falls in, as "2026-Q4". */
export function lastEndedQuarter(today: string): string {
  const [y, q] = quarterOf(today).split("-Q").map(Number);
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

/** The demo's report to release, or null while the project has not yet run through a whole quarter. */
export function demoReportQuarter(projectStart: string | null, today: string): string | null {
  if (!projectStart) return null;
  const q = lastEndedQuarter(today);
  return q >= quarterOf(projectStart) ? q : null;
}

/** Programme lines paid by the Demo Foundation grant, salaries reported to it as cost share; operations paid by Agri Futures. */
export const DEMO_FUNDING: Record<string, { lines: string[]; share: string[] }> = {
  "Demo Foundation (fictional)": { lines: ["2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "4.1", "4.2", "4.3"], share: ["1.1", "1.2"] },
  "Agri Futures Fund (fictional)": { lines: ["5.1", "5.2"], share: [] },
};

const SECTIONS: Record<string, string> = {
  summary: "This quarter the project trained its first farmers, checked plots for readiness and began handing out seed and fertilizer. The figures in this report come from the records Roots of Peace has accepted, each with its proof.",
  background: "The project works with maize farmers in a fictional province. Yields are low because seed is recycled and fertilizer is used late or not at all. The project trains farmers, prepares plots with them and supplies quality inputs before planting.",
  gender: "Women are invited to every training session, and sessions are held near villages so that they can attend. Their numbers are given in the breakdowns in this report.",
  principled: "Farmers chose the training days with the extension team. Inputs go only to farmers whose plots passed the readiness check, and every handout is signed for.",
  partnerships: "The district agriculture office was invited to the readiness checks.",
  safeguards: "No safeguard issues this quarter.",
  grm: "Farmers can raise a concern with the extension agent or by telephone. Cases received and resolved are counted below.",
  story: "A farmer who had only ever planted saved seed prepared a plot with the extension agent and will plant certified seed this season.",
  challenges: "Some plots were not ready at the first check and were given time to be corrected before inputs were handed out.",
  lessons: "Checking plots before inputs are handed out keeps seed and fertilizer from going to farmers who cannot plant them in time.",
  next: "Next quarter: finish the input handout, follow up planting on every plot and record the first planting results.",
};

/**
 * Sets what each demo donor funds and releases the demo's last ended quarter, as on the morning of
 * the demo. Does nothing about the report while no quarter has ended since the project started.
 */
export async function seedDemoReport(projectId: string, today = realToday()) {
  const [project] = await db.select({ code: s.projects.code, name: s.projects.name, startDate: s.projects.startDate }).from(s.projects).where(eq(s.projects.id, projectId)).limit(1);
  if (!project?.code) return null;

  const donors = await db.select({ id: s.donors.id, name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, projectId)).orderBy(asc(s.donors.createdAt));
  const book: DonorFundingBook = {};
  for (const d of donors) if (DEMO_FUNDING[d.name]) book[d.id] = DEMO_FUNDING[d.name];
  if (Object.keys(book).length) await saveProjectState(projectId, DONOR_FUNDING_KEY, book);

  const quarter = demoReportQuarter(project.startDate, today);
  if (!quarter) return null;
  // Released a few days after the quarter ended, before its deadline.
  const [y, q] = quarter.split("-Q").map(Number);
  const at = new Date(Date.UTC(q === 4 ? y + 1 : y, q === 4 ? 0 : q * 3, 8, 9)).toISOString();
  const saved: Qpr = {
    ...emptyQpr(project.name),
    info: { title: project.name, agreement: "A-2027 (fictional)", locations: "Village B (fictional)", partner: "Roots of Peace", director: "Demo project director (fictional)" },
    sections: Object.fromEntries(Object.entries(SECTIONS).map(([k, text]) => [k, { text, by: DEMO_REPORT_BY, at }])),
    risks: [{ risk: "Inputs arrive after the planting window opens.", mitigation: "Purchases follow the procurement calendar, with delivery due before the window." }],
    grm: { received: 2, resolved: 2 },
  };
  await saveQpr(project.code, quarter, saved);
  const d = await qprData(project.code, quarter);
  const released: Qpr = { ...d.saved, released: { by: DEMO_REPORT_BY, at } };
  await saveQpr(project.code, quarter, released);
  await addCopy(project.code, quarter, { kind: "release", by: DEMO_REPORT_BY, at, work: await reportWork(project.code, quarter), data: copyOf({ ...d, saved: released }) });
  return quarter;
}
