import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { reportBlock, type Story, type StoryAction } from "@/lib/stories";
import { draftStructured } from "@/server/ai-structured";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { aiAllowed } from "@/server/limits";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { loadQpr, saveQpr } from "@/server/qpr-store";
import { loadResults, loadUpdates } from "@/server/results-store";

/** Success stories, in project_state ("stories"). Every change is in the audit trail. */

export const mayWriteStory = (u: AppUser) => u.kind === "employee" && (u.fieldAccess === "edit" || u.admin || u.project.some((r) => ["mel-owner", "plan-approver", "monthly-review", "report-release"].includes(r)));
export const mayApproveStory = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["mel-owner", "plan-approver", "report-release"].includes(r)));

async function load(code: string) {
  const p = await projectByCode(code);
  return { p, list: (await loadProjectState<{ stories: Story[] }>(p.id, "stories", { stories: [] })).stories };
}

export async function storiesView(code: string, u: AppUser) {
  const { list } = await load(code);
  const results = (await loadResults(code)).filter((r) => r.status === "accepted").slice(0, 200).map((r) => ({ id: r.id, kind: "result" as const, date: r.date, text: `${r.indicator}: ${r.value} · ${[r.district, r.province].filter(Boolean).join(", ")} · ${r.note.slice(0, 120)}` }));
  const updates = (await loadUpdates(code)).slice(0, 100).map((x) => ({ id: x.id, kind: "update" as const, date: x.date, text: `${x.title ? `${x.title}: ` : ""}${x.note.slice(0, 140)}` }));
  return {
    stories: [...list].sort((a, b) => b.at.localeCompare(a.at)).map((s) => ({ ...s, reportBlock: reportBlock(s) })),
    sources: [...updates, ...results].sort((a, b) => b.date.localeCompare(a.date)),
    may: { write: mayWriteStory(u), approve: mayApproveStory(u), ai: !!process.env.ANTHROPIC_API_KEY },
    me: u.id,
  };
}

const SYSTEM = [
  "You write short human interest stories for Roots of Peace, an NGO helping Afghan farmers and businesses, for a donor's quarterly report.",
  "Use only the facts given: the staff's interview notes and the linked records. Invent nothing: no quotes, numbers, feelings or outcomes that are not in the notes.",
  "About 200 to 260 words, plain English, present the person with dignity, as someone acting, not a victim. Use the first name given; if none, write 'a farmer' or similar. Never a family name.",
  "Name the district and province, not the village. Lead with what changed for the person, then what the project did, then a closing line from the notes.",
].join(" ");
const draftSchema = z.object({ title: z.string(), story: z.string(), questions: z.array(z.string()).describe("Facts to confirm with the field team before use. Empty if none.") });

export async function storyAction(code: string, u: AppUser, a: StoryAction): Promise<{ id?: string; error?: string }> {
  const { p, list } = await load(code);
  const now = new Date().toISOString();
  const find = (id: string) => list.find((s) => s.id === id);
  const save = async (detail: Record<string, unknown>, action: string) => {
    await saveProjectState(p.id, "stories", { stories: list });
    await logAudit(db, p.id, { entity: "story", entityId: p.id, action, by: u.id, detail });
  };
  if (a.action === "save") {
    if (a.id) {
      const s = find(a.id);
      if (!s) return { error: "No such story." };
      if (s.status === "approved") return { error: "This story is approved: withdraw the approval to change it." };
      Object.assign(s, a.story);
      await save({ story: s.id, title: s.title }, "story_edited");
      return { id: s.id };
    }
    const s: Story = { ...a.story, id: randomUUID(), status: "draft", by: u.id, at: now };
    list.push(s);
    await save({ story: s.id, title: s.title }, "story_added");
    return { id: s.id };
  }
  const s = find(a.id);
  if (!s) return { error: "No such story." };
  if (a.action === "draft") {
    if (s.status === "approved") return { error: "This story is approved: withdraw the approval to redraft it." };
    const limit = await aiAllowed(u.id);
    if (limit) return { error: "The AI limit is reached for now. Try again later." };
    const results = await loadResults(code);
    const updates = await loadUpdates(code);
    const linked = [...results.filter((r) => s.links.includes(r.id)).map((r) => ({ date: r.date, indicator: r.indicator, value: r.value, place: [r.district, r.province].filter(Boolean).join(", "), note: r.note })), ...updates.filter((x) => s.links.includes(x.id)).map((x) => ({ date: x.date, title: x.title, note: x.note }))];
    const { out, model } = await draftStructured({ system: SYSTEM, task: "Write the story.", facts: { firstName: s.consent ? s.firstName : undefined, woman: s.woman, district: s.district, province: s.province, interviewNotes: s.notes, linkedRecords: linked }, schema: draftSchema, effort: "medium", maxTokens: 4000 });
    s.title = out.title.slice(0, 140);
    s.text = out.story.slice(0, 6000);
    s.questions = out.questions;
    s.drafted = { model, at: now };
    await save({ story: s.id }, "story_ai_drafted");
    return { id: s.id };
  }
  if (a.action === "approve") {
    if (!mayApproveStory(u)) return { error: "Only MEL and programme leads approve stories." };
    if (!s.consent) return { error: "Record the person's consent first." };
    if (s.text.trim().length < 50) return { error: "Write the story first." };
    s.status = "approved";
    s.approved = { by: u.id, at: now };
    await save({ story: s.id }, "story_approved");
    return { id: s.id };
  }
  if (a.action === "unapprove") {
    if (!mayApproveStory(u)) return { error: "Only MEL and programme leads withdraw an approval." };
    s.status = "draft";
    delete s.approved;
    await save({ story: s.id, reason: a.reason }, "story_unapproved");
    return { id: s.id };
  }
  if (a.action === "remove") {
    if (s.status === "approved") return { error: "Withdraw the approval first." };
    if (s.by !== u.id && !mayApproveStory(u)) return { error: "Only the person who wrote it, MEL or a programme lead removes a story." };
    list.splice(list.indexOf(s), 1);
    await save({ story: s.id, title: s.title }, "story_removed");
    return { id: s.id };
  }
  // to-report: the story becomes the quarter's Human Interest Story section, if its consent and approval allow.
  const block = reportBlock(s);
  if (block) return { error: block };
  const q = await loadQpr(code, a.quarter);
  if (q.released) return { error: "That report is released and can no longer change." };
  q.sections.story = { text: `${s.title}\n\n${s.text}`, by: u.id, at: now };
  await saveQpr(code, a.quarter, q);
  await logAudit(db, p.id, { entity: "qpr", entityId: p.id, action: "qpr_edited", by: u.id, detail: { quarter: a.quarter, part: "section", key: "story", story: s.id } });
  return { id: s.id };
}
