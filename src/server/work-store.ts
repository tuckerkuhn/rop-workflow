import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { NewWorkItem, WorkItem } from "@/lib/work-items";
import { projectByCode } from "@/server/field-store";

/** Tasks and milestones in Postgres, one `work_items` row each. */

type Row = typeof s.workItems.$inferSelect;

const toWorkItem = (r: Row): WorkItem => ({
  id: r.id,
  type: r.type,
  title: r.title,
  date: r.date,
  endDate: r.endDate,
  milestoneKind: r.milestoneKind,
  assignee: r.assignee,
  doneAt: r.doneAt?.toISOString() ?? null,
  doneBy: r.doneBy,
  createdBy: r.createdBy,
  automatic: !!r.sourceKey && !r.sourceKey.startsWith("demo:"),
});

/** Demo projects that live only in the browser have no row; they get an empty list. */
async function projectOrNull(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  return p ?? null;
}

export async function listWorkItems(code: string) {
  const project = await projectOrNull(code);
  if (!project) return { saved: false, items: [] as WorkItem[] };
  const rows = await db.select().from(s.workItems).where(eq(s.workItems.projectId, project.id)).orderBy(asc(s.workItems.date), asc(s.workItems.createdAt));
  return { saved: true, items: rows.map(toWorkItem) };
}

export async function createWorkItem(code: string, item: NewWorkItem, by: string) {
  const project = await projectByCode(code);
  const [row] = await db
    .insert(s.workItems)
    .values({
      organizationId: project.organizationId,
      projectId: project.id,
      type: item.type,
      title: item.title,
      date: item.date,
      endDate: item.type === "milestone" ? item.endDate : null,
      milestoneKind: item.type === "milestone" ? item.milestoneKind : null,
      assignee: item.type === "task" ? item.assignee : null,
      createdBy: by,
    })
    .returning();
  return toWorkItem(row);
}

/** Ticks a task off or back on. Returns null when there is no such task on the project. */
export async function setTaskDone(code: string, id: string, done: boolean, by: string) {
  const project = await projectByCode(code);
  const [row] = await db
    .update(s.workItems)
    .set({ doneAt: done ? new Date() : null, doneBy: done ? by : null, updatedAt: new Date() })
    .where(and(eq(s.workItems.id, id), eq(s.workItems.projectId, project.id), eq(s.workItems.type, "task")))
    .returning();
  return row ? toWorkItem(row) : null;
}

/** Items the app made itself cannot be deleted here; they come back from their source. */
export async function deleteWorkItem(code: string, id: string) {
  const project = await projectByCode(code);
  const [row] = await db.select().from(s.workItems).where(and(eq(s.workItems.id, id), eq(s.workItems.projectId, project.id))).limit(1);
  if (!row) return "missing" as const;
  if (row.sourceKey && !row.sourceKey.startsWith("demo:")) return "automatic" as const;
  await db.delete(s.workItems).where(eq(s.workItems.id, row.id));
  return "deleted" as const;
}

/** Fictional tasks and milestones for demo project A-2027, around the demo date 2027-03-04. */
const DEMO: (Omit<typeof s.workItems.$inferInsert, "projectId" | "organizationId" | "sourceKey"> & { key: string })[] = [
  { key: "report-march", type: "milestone", milestoneKind: "report_deadline", title: "Monthly report: February", date: "2027-03-08" },
  { key: "report-q1", type: "milestone", milestoneKind: "report_deadline", title: "Quarterly progress report to the donor", date: "2027-04-15" },
  { key: "distribution-day", type: "milestone", milestoneKind: "field_activity", title: "Input distribution day, Village B", date: "2027-03-10" },
  { key: "planting-window", type: "milestone", milestoneKind: "field_activity", title: "Planting window closes", date: "2027-03-20" },
  { key: "donor-visit", type: "milestone", milestoneKind: "other", title: "Donor field visit", date: "2027-05-12" },
  { key: "harvest", type: "milestone", milestoneKind: "harvest_window", title: "Maize harvest", date: "2027-08-15", endDate: "2027-09-30" },
  { key: "transport", type: "task", title: "Confirm transport for input distribution", date: "2027-03-03", assignee: "bilal" },
  { key: "attendance", type: "task", title: "Send February training attendance sheets to MEL", date: "2027-03-05", assignee: "farida" },
  { key: "venue", type: "task", title: "Book the venue for follow-on trainings", date: "2027-03-25", assignee: "farida" },
  { key: "guide", type: "task", title: "Share the planting guide with lead farmers", date: null, assignee: null },
  { key: "contacts", type: "task", title: "Update the community leaders contact list", date: "2027-02-26", assignee: "nadia", doneAt: new Date("2027-02-25T10:00:00Z"), doneBy: "nadia" },
];

/** Adds the demo items, leaving any already there. Safe to run repeatedly. */
export async function seedWorkItems(projectId: string, organizationId: string) {
  await db
    .insert(s.workItems)
    .values(DEMO.map(({ key, ...item }) => ({ ...item, projectId, organizationId, sourceKey: `demo:${key}`, createdBy: "demo" })))
    .onConflictDoNothing();
}
