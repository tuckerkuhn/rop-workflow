"use client";

import { comingTo } from "@/components/field/workspace";
import { procurementComingTo } from "@/components/procurement/workspace";
import { PROJECT, daysFrom, projectPath, stepHistory, type AppUser, type Stage } from "@/lib/demo";
import { farmerLabel, fieldSteps, ownerOfItem, projectItem, type FieldItem } from "@/lib/field";
import { ownerOf, procRolesFor, stepById, stepsFor, type Procurement } from "@/lib/procurement";
import { actualFor, indicators, type ProjectState } from "@/lib/project";
import { blockers, fromProcurement, monthsOf, type Closeouts } from "@/lib/closeout";
import { awaiting, type PlanItem } from "@/lib/procurement-plan";
import { today } from "@/lib/clock";

/** One person's work across the workflows, shared by Home and Tasks. */

export type Space = "Project" | "Field" | "Procurement";
export type WorkCard = { key: string; title: string; step: string; date: string; href: string; space: Space; now: boolean; late: boolean; note: string };
export type Data = {
  field: FieldItem[];
  procs: Procurement[];
  project: ProjectState;
  stages: Record<string, Stage | undefined>;
  /** The project's procurement calendar and Finance's closed months, where it has them. */
  plan?: PlanItem[];
  closeouts?: Closeouts;
  /** False on projects other than the demo, whose sample sign-offs belong to it alone. */
  sampleSignOffs?: boolean;
};

const lastDate = (t: { date: string }[]) => (t.length ? t[t.length - 1].date : today());
const isLate = (step: string, since: string) => daysFrom(since, today()) > (stepHistory[step]?.median ?? 3);

/** Everything on one person's plate: workflow steps they hold, project sign-offs, and what is projected to reach them. */
export function workFor(u: AppUser, data: Data, viewer: AppUser, opts: { projectCards?: boolean } = {}): WorkCard[] {
  const { field, procs, project } = data;
  const cards: WorkCard[] = [];
  for (const r of u.field) {
    field
      .filter((i) => ownerOfItem(i) === r)
      .forEach((i) => {
        const since = lastDate(i.timeline);
        cards.push({
          key: `f-${i.id}`,
          title: i.kind === "farmer" ? farmerLabel(i, viewer) : i.title,
          step: fieldSteps[i.step].title,
          date: projectItem(i)[0]?.end ?? today(),
          href: `/work?source=field&open=${i.id}`,
          space: "Field",
          now: true,
          late: isLate(i.step, since),
          note: "",
        });
      });
    comingTo(field, r, viewer).forEach((c) =>
      cards.push({ key: `fc-${c.id}-${c.step}`, title: c.title, step: c.step, date: c.eta, href: `/work?source=field&open=${c.id}`, space: "Field", now: false, late: false, note: `Now ${c.via}` }),
    );
  }
  for (const r of u.procurement) {
    procs
      .filter((p) => ownerOf(p) === r)
      .forEach((p) => {
        const list = stepsFor(p);
        const i = list.findIndex((s) => s.id === p.step);
        const since = lastDate(p.timeline);
        const path = projectPath(
          list.slice(i).map((s) => ({ step: s.id, owner: s.owner })),
          since,
          today(),
        );
        cards.push({
          key: `p-${p.id}`,
          title: `${p.title} · ${p.id}`,
          step: stepById[p.step].title,
          date: path[0]?.end ?? today(),
          href: `/work?source=procurement&open=${p.id}`,
          space: "Procurement",
          now: true,
          late: isLate(p.step, since),
          note: "",
        });
      });
    procurementComingTo(procs, r).forEach((c) =>
      cards.push({ key: `pc-${c.id}-${c.step}`, title: c.title, step: c.step, date: c.eta, href: `/work?source=procurement&open=${c.id}`, space: "Procurement", now: false, late: false, note: `Now ${c.via}` }),
    );
  }
  // Procurement calendar: approvals waiting on this person, then approved purchases they start.
  const plan = data.plan ?? [];
  const wait = awaiting(plan, u);
  const approve = (n: number, as: "manager" | "lead") =>
    cards.push({
      key: `pp-approve-${as}`,
      title: `Approve ${n} planned ${n === 1 ? "purchase" : "purchases"}`,
      step: as === "manager" ? "Procurement calendar · as procurement manager" : "Procurement calendar · as technical lead",
      date: today(),
      href: "/work/plan?filter=mine",
      space: "Procurement",
      now: true,
      late: false,
      note: "",
    });
  if (wait.asManager.length) approve(wait.asManager.length, "manager");
  if (wait.asLead.length) approve(wait.asLead.length, "lead");
  for (const i of plan.filter((x) => x.status === "approved" && x.techLead === u.id))
    cards.push({
      key: `pp-start-${i.key}`,
      title: `Start procurement: ${i.title}`,
      step: `${i.key} · ${i.level} · needed by ${i.neededBy}`,
      date: i.startBy,
      // Opens the request already filled in from the plan, with its supporting information.
      href: `/work?source=procurement&new=1&plan=${i.key}`,
      space: "Procurement",
      now: true,
      late: i.startBy < today(),
      note: "",
    });
  // Monthly closeout: ended months with vouchers that Finance has not closed.
  if (procRolesFor(u).includes("finance") && data.closeouts)
    for (const [m, list] of monthsOf(procs.flatMap((p) => fromProcurement(p, stepById[p.step]?.title ?? p.step))))
      if (m < today().slice(0, 7) && !data.closeouts[m])
        cards.push({
          key: `close-${m}`,
          title: `Close ${m}: ${list.length} expense ${list.length === 1 ? "voucher" : "vouchers"}`,
          step: blockers(list).length ? `${blockers(list).length} not yet filed or posted` : "All filed and posted",
          date: today(),
          href: "/work/closeout",
          space: "Procurement",
          now: true,
          late: false,
          note: "",
        });

  if (opts.projectCards === false || data.sampleSignOffs === false) return cards.sort((a, b) => a.date.localeCompare(b.date));
  // Project sign-offs from the build spec.
  const pending = project.submissions.filter((s) => s.status === "pending").length;
  const unapproved = indicators.filter((i) => {
    if (i.source === "survey") return false;
    const a = project.actualApprovals[i.id];
    return !a || a.note !== String(actualFor(i, project.submissions).value);
  }).length;
  const proj = (key: string, title: string, step: string, tab: string, days: number) =>
    cards.push({ key, title, step, date: new Date(Date.parse(today()) + days * 86400000).toISOString().slice(0, 10), href: `/progress/records?project=${PROJECT.id}#${tab}`, space: "Project", now: true, late: false, note: "" });
  if (u.project.includes("mel-owner")) {
    if (pending) proj("pj-queue", `${pending} Kobo submissions to review`, "Accept or query in the review queue", "verify", 1);
    if (unapproved) proj("pj-actuals", `${unapproved} results to approve`, "Approve this period's results", "verify", 3);
  }
  if (u.project.includes("finance-import") && !project.importedOn) proj("pj-import", "March NetSuite export", "Import and map spend to budget lines", "budget", 2);
  if (u.project.includes("monthly-review")) {
    const open = project.changes.filter((c) => c.status === "proposed").length;
    if (open) proj("pj-review", `${open} proposed changes`, "Decide in the monthly review", "overview", 4);
  }
  if (u.project.includes("report-release") && !project.reportRelease) proj("pj-report", "March progress report", "Review and release", "report", 7);
  return cards.sort((a, b) => a.date.localeCompare(b.date));
}
