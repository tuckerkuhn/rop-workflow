"use client";

import { comingTo } from "@/components/field/workspace";
import { procurementComingTo } from "@/components/procurement/workspace";
import { TODAY } from "@/components/workspace/ui";
import { PROJECT, daysFrom, projectPath, stepHistory, type AppUser, type Stage } from "@/lib/demo";
import { farmerLabel, fieldSteps, ownerOfItem, projectItem, type FieldItem } from "@/lib/field";
import { ownerOf, stepById, stepsFor, type Procurement } from "@/lib/procurement";
import { actualFor, indicators, type ProjectState } from "@/lib/project";

/** One person's work across the workflows, shared by Home and Tasks. */

export type Space = "Project" | "Field" | "Procurement";
export type WorkCard = { key: string; title: string; step: string; date: string; href: string; space: Space; now: boolean; late: boolean; note: string };
export type Data = { field: FieldItem[]; procs: Procurement[]; project: ProjectState; stages: Record<string, Stage | undefined> };

const lastDate = (t: { date: string }[]) => (t.length ? t[t.length - 1].date : TODAY);
const isLate = (step: string, since: string) => daysFrom(since, TODAY) > (stepHistory[step]?.median ?? 3);

/** Everything on one person's plate: workflow steps they hold, project sign-offs, and what is projected to reach them. */
export function workFor(u: AppUser, { field, procs, project }: Data, viewer: AppUser): WorkCard[] {
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
          date: projectItem(i)[0]?.end ?? TODAY,
          href: `/tasks?source=field&open=${i.id}`,
          space: "Field",
          now: true,
          late: isLate(i.step, since),
          note: "",
        });
      });
    comingTo(field, r, viewer).forEach((c) =>
      cards.push({ key: `fc-${c.id}-${c.step}`, title: c.title, step: c.step, date: c.eta, href: `/tasks?source=field&open=${c.id}`, space: "Field", now: false, late: false, note: `Now ${c.via}` }),
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
          TODAY,
        );
        cards.push({
          key: `p-${p.id}`,
          title: `${p.title} · ${p.id}`,
          step: stepById[p.step].title,
          date: path[0]?.end ?? TODAY,
          href: `/tasks?source=procurement&open=${p.id}`,
          space: "Procurement",
          now: true,
          late: isLate(p.step, since),
          note: "",
        });
      });
    procurementComingTo(procs, r).forEach((c) =>
      cards.push({ key: `pc-${c.id}-${c.step}`, title: c.title, step: c.step, date: c.eta, href: `/tasks?source=procurement&open=${c.id}`, space: "Procurement", now: false, late: false, note: `Now ${c.via}` }),
    );
  }
  // Project sign-offs from the build spec.
  const pending = project.submissions.filter((s) => s.status === "pending").length;
  const unapproved = indicators.filter((i) => {
    if (i.source === "survey") return false;
    const a = project.actualApprovals[i.id];
    return !a || a.note !== String(actualFor(i, project.submissions).value);
  }).length;
  const proj = (key: string, title: string, step: string, tab: string, days: number) =>
    cards.push({ key, title, step, date: new Date(Date.parse(TODAY) + days * 86400000).toISOString().slice(0, 10), href: `/progress/records?project=${PROJECT.id}#${tab}`, space: "Project", now: true, late: false, note: "" });
  if (u.project.includes("mel-owner")) {
    if (pending) proj("pj-queue", `${pending} Kobo submissions to review`, "Accept or query in the review queue", "verify", 1);
    if (unapproved) proj("pj-actuals", `${unapproved} actuals to approve`, "Approve this period's actuals", "verify", 3);
  }
  if (u.project.includes("finance-import") && !project.importedOn) proj("pj-import", "March NetSuite export", "Import and map spend to budget lines", "budget", 2);
  if (u.project.includes("monthly-review")) {
    const open = project.changes.filter((c) => c.status === "proposed").length;
    if (open) proj("pj-review", `${open} proposed changes`, "Decide in the monthly review", "overview", 4);
  }
  if (u.project.includes("report-release") && !project.reportRelease) proj("pj-report", "March progress report", "Review and release", "report", 7);
  return cards.sort((a, b) => a.date.localeCompare(b.date));
}
