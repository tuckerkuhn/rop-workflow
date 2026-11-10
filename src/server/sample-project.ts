import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Bva, BvaLine } from "@/lib/bva";
import type { PhotosState } from "@/lib/photos";
import { emptyQpr, type Qpr } from "@/lib/qpr";
import type { ResultInput } from "@/lib/results";
import { orchardPng, samplePdf } from "@/lib/sample-files";
import { logAudit } from "@/server/audit";
import { SAMPLE_PREFIX } from "@/server/auth";
import { saveActuals, loadActuals } from "@/server/actuals-store";
import { saveFile } from "@/server/hr-files";
import { loadLineReasons, saveLineReason } from "@/server/overspend-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { addCopy, copyOf, loadCopies, loadQpr, qprData, reportWork, saveQpr } from "@/server/qpr-store";

/**
 * The sample project (C5): one finished, fictional project for an organization to look at before
 * setting up its own. Targets, accepted results with proof, a budget with nine months of spending
 * (one line over, with its reason) and one released quarterly report, whose evidence pack opens
 * from it. Read-only for everyone (server/auth requireViewer), left out of every total
 * (server/project-store listProjects), and hidden by an administrator in Settings.
 *
 * Every name, place, figure and file here is invented. Safe to run again: each step checks
 * whether it is done, so a run that stopped part-way is finished by the next.
 */

/** Who "did" the sample's work: no real person. */
export const SAMPLE_BY = "sample";
/** The quarter whose report the sample has released. */
export const SAMPLE_QUARTER = "2026-Q3";
const QUARTER = SAMPLE_QUARTER;
const RELEASED_AT = "2026-10-12T09:00:00.000Z";
const PROVINCE = "Highland Province (fictional)";

export const sampleCode = (orgId: string) => `${SAMPLE_PREFIX}${orgId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()}`;

export const SAMPLE_INDICATORS = [
  { code: "IND-1", donorCode: "1.1.1", name: "Farmers trained in apricot orchard management", unit: "farmers", target: 600, forecast: { "2026": 300 }, level: "output", budgetRef: "S-1.1.A", disaggregation: ["sex", "province"], verification: "Attendance sheets" },
  { code: "IND-2", donorCode: "1.2.1", name: "Hectares of apricot orchards rehabilitated", unit: "ha", target: 120, forecast: { "2026": 60 }, level: "output", budgetRef: "S-1.2.A", disaggregation: ["province"], verification: "Field verification reports" },
  { code: "IND-3", donorCode: "2.1.1", name: "Solar drying units installed with farmer groups", unit: "units", target: 40, forecast: { "2026": 20 }, level: "output", budgetRef: "S-2.1.A", disaggregation: ["province"], verification: "Handover certificates" },
  { code: "IND-4", donorCode: "2.2.1", name: "Tonnes of dried apricots sold through collective marketing", unit: "t", target: 300, forecast: { "2026": 120 }, level: "outcome", budgetRef: "S-2.2.A", disaggregation: ["province"], verification: "Sales receipts from the collection centre" },
] as const;

export const SAMPLE_LINES = [
  { code: "S-1.1.A", description: "Orchard management training", activityCode: "1.1.1", activity: "Train farmers in orchard management", kind: "program", amount: 60000, spent: 27400 },
  { code: "S-1.1.B", description: "Training materials and printing", activityCode: "1.1.1", activity: "Train farmers in orchard management", kind: "program", amount: 12000, spent: 13100 },
  { code: "S-1.2.A", description: "Orchard rehabilitation inputs", activityCode: "1.2.1", activity: "Rehabilitate apricot orchards", kind: "program", amount: 150000, spent: 61800 },
  { code: "S-1.2.B", description: "Pruning tools for farmer groups", activityCode: "1.2.1", activity: "Rehabilitate apricot orchards", kind: "program", amount: 25000, spent: 18600 },
  { code: "S-2.1.A", description: "Solar drying units", activityCode: "2.1.1", activity: "Install solar dryers with farmer groups", kind: "program", amount: 120000, spent: 72000 },
  { code: "S-2.1.B", description: "Dryer installation and training", activityCode: "2.1.1", activity: "Install solar dryers with farmer groups", kind: "program", amount: 30000, spent: 14200 },
  { code: "S-2.2.A", description: "Collective marketing and collection centre", activityCode: "2.2.1", activity: "Sell dried apricots through collective marketing", kind: "program", amount: 45000, spent: 15300 },
  { code: "S-2.2.B", description: "Trade fair participation", activityCode: "2.2.1", activity: "Sell dried apricots through collective marketing", kind: "program", amount: 20000, spent: 6200 },
  { code: "S-P.1", description: "Field staff salaries", activityCode: null, activity: null, kind: "personnel", amount: 180000, spent: 67500 },
  { code: "S-P.2", description: "Monitoring and evaluation officer", activityCode: null, activity: null, kind: "personnel", amount: 48000, spent: 18000 },
  { code: "S-O.1", description: "Vehicle rental", activityCode: null, activity: null, kind: "operations", amount: 36000, spent: 13500 },
  { code: "S-O.2", description: "Office and communications", activityCode: null, activity: null, kind: "operations", amount: 24000, spent: 9100 },
] as const;

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
/** The quarters still to come, over which each line's remaining budget is planned. */
const LATER = ["2026-10-01", "2027-01-01", "2027-04-01", "2027-07-01", "2027-10-01"];

type Proof = { kind: "pdf"; title: string; lines: string[] } | { kind: "photo"; caption: string };
type SampleResult = { indicator: string; date: string; value: number; female?: number; male?: number; note: string; proof: Proof[] };

export const SAMPLE_RESULTS: SampleResult[] = [
  { indicator: "IND-1", date: "2026-02-18", value: 80, female: 32, male: 48, note: "Two-day training on winter pruning and orchard hygiene for farmer group members in the upper valley.", proof: [{ kind: "pdf", title: "Attendance sheet: winter pruning", lines: ["Training: winter pruning and orchard hygiene", "Days: 2", "Participants: 80 (32 women, 48 men)"] }, { kind: "photo", caption: "Farmer group orchards in the upper valley after winter pruning" }] },
  { indicator: "IND-1", date: "2026-04-22", value: 95, female: 41, male: 54, note: "Training on flowering-season care, frost protection and pest scouting, held at three farmer group sites.", proof: [{ kind: "pdf", title: "Attendance sheet: flowering-season care", lines: ["Training: flowering-season care and frost protection", "Sites: 3", "Participants: 95 (41 women, 54 men)"] }] },
  { indicator: "IND-1", date: "2026-06-10", value: 110, female: 47, male: 63, note: "Harvest and post-harvest handling training ahead of the apricot harvest, with practical sessions in member orchards.", proof: [{ kind: "pdf", title: "Attendance sheet: harvest handling", lines: ["Training: harvest and post-harvest handling", "Participants: 110 (47 women, 63 men)"] }] },
  { indicator: "IND-1", date: "2026-08-26", value: 70, female: 30, male: 40, note: "Drying and grading training for members of the new solar dryer groups, covering hygiene and quality grades.", proof: [{ kind: "pdf", title: "Attendance sheet: drying and grading", lines: ["Training: solar drying, hygiene and grading", "Participants: 70 (30 women, 40 men)"] }] },
  { indicator: "IND-2", date: "2026-03-30", value: 20, note: "Rehabilitation of 20 hectares completed: dead wood removed, gaps replanted with certified saplings and basins rebuilt.", proof: [{ kind: "pdf", title: "Field verification report: block A", lines: ["Area verified: 20 ha", "Work: dead wood removed, gaps replanted, basins rebuilt", "Verified by the project's monitoring officer"] }, { kind: "photo", caption: "Rehabilitated orchard block A in spring" }] },
  { indicator: "IND-2", date: "2026-05-28", value: 25, note: "A further 25 hectares rehabilitated, with drip lines repaired on the steeper terraces.", proof: [{ kind: "pdf", title: "Field verification report: block B", lines: ["Area verified: 25 ha", "Work: replanting and drip line repairs on terraces"] }] },
  { indicator: "IND-2", date: "2026-09-15", value: 18, note: "18 hectares rehabilitated in the lower valley after the harvest, including new windbreak rows.", proof: [{ kind: "pdf", title: "Field verification report: block C", lines: ["Area verified: 18 ha", "Work: rehabilitation and windbreak planting"] }, { kind: "photo", caption: "Lower valley orchards after rehabilitation" }] },
  { indicator: "IND-3", date: "2026-05-14", value: 8, note: "Eight solar drying units handed over to farmer groups, each with a trained group member responsible for it.", proof: [{ kind: "pdf", title: "Handover certificate: dryers 1 to 8", lines: ["Units handed over: 8", "Each group named a member responsible for the unit"] }] },
  { indicator: "IND-3", date: "2026-07-09", value: 10, note: "Ten more drying units installed and handed over before the main drying season.", proof: [{ kind: "pdf", title: "Handover certificate: dryers 9 to 18", lines: ["Units handed over: 10", "Installed before the main drying season"] }, { kind: "photo", caption: "Orchards beside the new drying units" }] },
  { indicator: "IND-3", date: "2026-09-03", value: 6, note: "Six drying units installed with women's farmer groups, with shade structures added at their request.", proof: [{ kind: "pdf", title: "Handover certificate: dryers 19 to 24", lines: ["Units handed over: 6", "Shade structures added at the groups' request"] }] },
  { indicator: "IND-4", date: "2026-08-20", value: 40, note: "First collective sale of graded dried apricots through the collection centre to two wholesale buyers.", proof: [{ kind: "pdf", title: "Sales receipts: August", lines: ["Dried apricots sold: 40 t", "Buyers: 2 wholesale traders"] }] },
  { indicator: "IND-4", date: "2026-09-24", value: 65, note: "Second collective sale, with a better price for the top grade after the drying and grading training.", proof: [{ kind: "pdf", title: "Sales receipts: September", lines: ["Dried apricots sold: 65 t", "Top grade sold at a higher price than in August"] }] },
];

const SECTIONS: Record<string, string> = {
  summary:
    "This quarter the project trained 70 more farmers in drying and grading, installed 16 solar drying units and rehabilitated 18 hectares of orchards. Farmer groups made their first two collective sales: 105 tonnes of graded dried apricots. Training is on track at 355 of 600 farmers; sales are behind plan because the first sale came after the harvest was delayed by late frost.",
  background: "The project works with apricot farmer groups in a fictional highland province. Orchards are old and yields low; most fruit is sun-dried on the ground and sold ungraded at low prices. The project rehabilitates orchards, introduces solar drying and links groups to buyers through a shared collection centre.",
  gender: "Women are 43% of the farmers trained so far. Six of the 24 drying units went to women's groups this quarter, with shade structures they asked for. Women's groups made 30% of the September sale.",
  principled: "Groups chose their own members to look after the drying units. Buyers were invited through an open call, and prices were agreed in front of the group members.",
  partnerships: "The provincial agriculture office joined the verification of rehabilitated orchards. Two wholesale traders signed purchase agreements for next season.",
  safeguards: "No safeguard issues this quarter. Pruning waste was chipped and returned to the orchards rather than burned.",
  grm: "Six cases were received this quarter, mostly about the order in which groups would receive drying units. Five were resolved; one is open and will be closed when the last units are installed.",
  story: "A women's farmer group in the lower valley used to dry its fruit on rooftops. With a solar dryer and grading training, the group sold its top grade at a better price in September and plans to enlarge its orchard next year.",
  challenges: "A late frost delayed the harvest by three weeks, which moved the first collective sale from July to August. Printing costs for training materials rose in the second quarter.",
  lessons: "Groups that chose their own dryer keeper kept the units cleaner and used them more. Grading training is worth giving before the first sale, not after it.",
  next: "Next quarter: install the remaining drying units, finish winter pruning training for new members, and prepare the third collective sale for the winter market.",
};

/**
 * Builds the organization's sample project, or finishes one that stopped part-way. Returns its code.
 * `rebuildReport` makes the released report again (the sample's only: a real report is never
 * remade), for when the sample's content changes.
 */
export async function createSampleProject(orgId: string, orgName: string, by: string, opts: { rebuildReport?: boolean } = {}): Promise<string> {
  const code = sampleCode(orgId);
  let [project] = await db.select().from(s.projects).where(and(eq(s.projects.organizationId, orgId), eq(s.projects.kind, "sample"))).limit(1);
  if (!project) {
    [project] = await db
      .insert(s.projects)
      .values({ organizationId: orgId, code, name: "Sample: Highland Apricot Value Chain (fictional)", country: "AF", donor: "Sample Donor Fund", startDate: "2026-01-01", endDate: "2027-12-31", crop: "Apricot", goal: "Apricot farmers earn more from better orchards, solar drying and selling together.", stage: "Execute", kind: "sample" })
      .returning();
    await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "sample_project_created", by, detail: { code, note: "Fictional sample project (C5): read-only, left out of totals." } });
  }
  const pid = project.id;
  const pcode = project.code!;

  // Targets.
  const haveInd = await db.select({ id: s.indicators.id }).from(s.indicators).where(eq(s.indicators.projectId, pid)).limit(1);
  if (!haveInd.length)
    await db.insert(s.indicators).values(
      SAMPLE_INDICATORS.map((i, n) => ({ projectId: pid, code: i.code, donorCode: i.donorCode, name: i.name, unit: i.unit, target: String(i.target), forecast: { ...i.forecast }, level: i.level, source: "results", frequency: "quarterly" as const, budgetRef: i.budgetRef, disaggregation: [...i.disaggregation], verification: i.verification, baseline: "0", position: n })),
    );

  // The budget, with the rest of each line planned over the quarters to come.
  const haveLines = await db.select({ id: s.budgetLines.id }).from(s.budgetLines).where(eq(s.budgetLines.projectId, pid)).limit(1);
  if (!haveLines.length)
    await db.insert(s.budgetLines).values(
      SAMPLE_LINES.map((l, n) => {
        const left = Math.max(0, l.amount - l.spent);
        return { projectId: pid, code: l.code, description: l.description, amount: String(l.amount), currency: "USD", activityCode: l.activityCode, activity: l.activity, kind: l.kind, schedule: Object.fromEntries(LATER.map((q) => [q, Math.round(left / LATER.length)])), sort: n };
      }),
    );

  // Results with their proof, accepted.
  const haveResults = await db.select({ id: s.evidence.id }).from(s.evidence).where(and(eq(s.evidence.projectId, pid), eq(s.evidence.form, "result"))).limit(1);
  if (!haveResults.length) {
    let seed = 1;
    for (const r of SAMPLE_RESULTS) {
      const files: ResultInput["files"] = [];
      const captions: Record<string, string> = {};
      const taken: Record<string, string> = {};
      for (const p of r.proof) {
        const f = p.kind === "pdf" ? await saveFile(samplePdf(`${p.title} (sample)`, [`Date: ${r.date}`, `Place: ${PROVINCE}`, ...p.lines]), `${p.title}.pdf`, "application/pdf", SAMPLE_BY) : await saveFile(orchardPng(seed++), "orchard.png", "image/png", SAMPLE_BY);
        files.push(f);
        if (p.kind === "photo") {
          captions[f.hash] = p.caption;
          taken[f.hash] = r.date;
        }
      }
      const payload: ResultInput = { indicator: r.indicator, date: r.date, value: r.value, ...(r.female !== undefined ? { female: r.female, male: r.male } : {}), province: PROVINCE, crop: "Apricot", note: r.note, files, ...(Object.keys(captions).length ? { captions, taken } : {}) };
      const reviewed = new Date(Date.parse(`${r.date}T12:00:00Z`) + 3 * 86400000);
      await db.insert(s.evidence).values({ organizationId: orgId, projectId: pid, source: "manual", form: "result", reviewStatus: "accepted", completedBy: SAMPLE_BY, completedAt: new Date(`${r.date}T12:00:00Z`), location: PROVINCE, payload, reviewedBy: SAMPLE_BY, reviewedAt: reviewed });
    }
  }

  // Nine months of spending, as if imported from Finance.
  if (!(await loadActuals(pcode)).imports.length) {
    const lines: BvaLine[] = SAMPLE_LINES.map((l) => {
      const per = Math.floor((l.spent / MONTHS.length) * 100) / 100;
      const months = Object.fromEntries(MONTHS.map((m, i) => [m, i === MONTHS.length - 1 ? Math.round((l.spent - per * (MONTHS.length - 1)) * 100) / 100 : per]));
      return { code: l.code, description: l.description, budget: l.amount, actual: l.spent, months };
    });
    const sum = (f: (l: BvaLine) => number) => lines.reduce((t, l) => t + f(l), 0);
    const monthTotals = Object.fromEntries(MONTHS.map((m) => [m, Math.round(sum((l) => l.months[m] ?? 0) * 100) / 100]));
    const totals = { budget: sum((l) => l.budget), actual: sum((l) => l.actual), months: monthTotals };
    const bva: Bva = { sheet: "Sample", currency: "USD", months: MONTHS, monthLabels: Object.fromEntries(MONTHS.map((m) => [m, new Date(`${m}-15`).toLocaleString("en-US", { month: "short", year: "numeric" })])), lines, totals: { costs: totals, overhead: null, grand: totals }, rate: null, problems: [], notes: [] };
    await saveActuals(pcode, bva, { name: "Sample spending, Jan to Sep 2026.xlsx", hash: "sample", sharepointUrl: null }, SAMPLE_BY);
  }

  // The one line over budget, with its reason.
  if (!(await loadLineReasons(pid))["S-1.1.B"]) await saveLineReason(pcode, "S-1.1.B", { reason: "price", note: "printing costs rose in the second quarter" }, SAMPLE_BY);

  // The pictures are drawn, with nobody in them: checked as such, so the report may carry them.
  const photos = await loadProjectState<PhotosState>(pid, "photos", { photos: {}, posts: [] });
  const evidence = await db.select({ payload: s.evidence.payload }).from(s.evidence).where(and(eq(s.evidence.projectId, pid), eq(s.evidence.form, "result")));
  const drawn = evidence.flatMap((e) => Object.entries((e.payload as ResultInput).captions ?? {}));
  if (drawn.some(([hash]) => !photos.photos[hash]?.coach)) {
    const at = new Date().toISOString();
    for (const [hash, caption] of drawn) photos.photos[hash] = { ...photos.photos[hash], coach: { isPhoto: true, label: "report", tips: [], shows: caption, people: "none", womenIdentifiable: false, model: "none: a drawn sample picture", at } };
    await saveProjectState(pid, "photos", photos);
  }

  // A rebuild starts the report again: the sample's own, never a real project's.
  if (opts.rebuildReport && project.kind === "sample") {
    await db.delete(s.projectState).where(and(eq(s.projectState.projectId, pid), inArray(s.projectState.key, [`qpr:${QUARTER}`, `qpr-copies:${QUARTER}`])));
    await logAudit(db, pid, { entity: "project", entityId: pid, action: "sample_report_rebuilt", by, detail: { quarter: QUARTER } });
  }

  // The released quarterly report, with its frozen copy.
  if (!(await loadCopies(pcode, QUARTER)).some((c) => c.kind === "release")) {
    const base = await loadQpr(pcode, QUARTER);
    const at = RELEASED_AT;
    const saved: Qpr = {
      ...emptyQpr(project.name),
      ...base,
      info: { title: "Highland Apricot Value Chain (sample)", agreement: "SAMPLE-0001", locations: PROVINCE, partner: orgName, director: "Sample Project Director", duration: "1 January 2026 to 31 December 2027" },
      sections: Object.fromEntries(Object.entries(SECTIONS).map(([k, text]) => [k, { text, by: SAMPLE_BY, at }])),
      risks: [
        { risk: "Late frost delays the harvest again next season.", mitigation: "Frost protection training before flowering; sales plan with a later window." },
        { risk: "Buyers pay late for collective sales.", mitigation: "Purchase agreements with payment within 30 days of delivery." },
      ],
      grm: { received: 6, resolved: 5 },
    };
    await saveQpr(pcode, QUARTER, saved);
    const d = await qprData(pcode, QUARTER);
    const released: Qpr = { ...d.saved, released: { by: SAMPLE_BY, at } };
    await saveQpr(pcode, QUARTER, released);
    await addCopy(pcode, QUARTER, { kind: "release", by: SAMPLE_BY, at, work: await reportWork(pcode, QUARTER), data: copyOf({ ...d, saved: released }) });
  }
  return pcode;
}
