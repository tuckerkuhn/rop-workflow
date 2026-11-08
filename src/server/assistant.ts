import { z } from "zod";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { DONE, stepById } from "@/lib/procurement";
import { loadActivities } from "@/server/activities-store";
import { draftStructured } from "@/server/ai-structured";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { loadFramework } from "@/server/framework-store";
import { loadHome } from "@/server/home-store";
import { loadProcurements } from "@/server/procurement-store";
import { loadProgressSummary } from "@/server/progress-summary-store";

/**
 * The AI assistant: answers a staff member's question about one project from the same records
 * the app shows them (results against targets, activities, budget flags, open procurements, what
 * needs them). No HR, pay or participants' personal data is given to the model. It answers in
 * plain language, says when the records do not hold the answer, and links to where to act.
 */

const PAGE_INFO: Record<string, string> = {
  "/home": "Home: what needs the person",
  "/progress": "Progress summary: wins and what needs attention",
  "/progress/results": "Results and proof (record, accept, query)",
  "/progress/review": "Monthly review (plan changes, sign-off)",
  "/progress/budget": "Budget vs actual",
  "/progress/report": "Quarterly donor report",
  "/progress/annual": "Annual and final reports",
  "/progress/framework": "Results framework tree",
  "/progress/learning": "Lessons and close-out",
  "/work": "Work hub and tasks",
  "/work/activities": "Workplan activities: owners, status, tasks",
  "/work/plan": "Procurement calendar (planned purchases)",
  "/work/suppliers": "Supplier register",
  "/work?source=procurement": "Procurement requests in progress",
  "/setup": "Project setup (plan, budget, workplan, indicators)",
};
const PAGES = Object.keys(PAGE_INFO);

export const answerSchema = z.object({
  answer: z.string().describe("The answer in plain language, a few short paragraphs or a short list at most. Numbers exactly as in the records."),
  links: z.array(z.object({ label: z.string(), href: z.string() })).describe(`Up to 3 pages where the person can see or act on this, labelled by what they are. Only these paths: ${Object.entries(PAGE_INFO).map(([k, v]) => `${k} = ${v}`).join("; ")}`),
  followUps: z.array(z.string()).describe("Up to 3 short follow-up questions the person might ask next."),
});
export type AssistantAnswer = z.infer<typeof answerSchema>;

export const SYSTEM = `You are the assistant inside ROP Workflow, the project management app of Roots of Peace (ROP), an NGO working on agricultural livelihoods in Afghanistan and elsewhere. You answer a staff member's question about one project.

Rules:
- Use only the facts given (JSON). If they do not answer the question, say so and say where in the app to look or who would know. Never invent a figure, date, name or reason.
- Lead with what matters for results: progress against targets and the activities that deliver it. Workflow (procurement steps, sign-offs, imports) comes second.
- Say "accepted results" when you give counts: only results MEL accepted count. Mention results still waiting for MEL when it changes the picture.
- Be brief and plain: short sentences, no jargon, no headings. A list only when the answer is a list.
- When asked to draft text (for a report or an email), draft it from the facts, mark anything that needs checking in [square brackets], and remind them a person checks it before it goes out.
- You do not change anything in the app. If asked to, say which page to do it on.`;

export async function factsFor(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [summary, home, acts, framework, procs] = await Promise.all([
    loadProgressSummary(code, u).catch(() => null),
    loadHome(code, u).catch(() => null),
    loadActivities(code, u).catch(() => null),
    loadFramework(code, u).catch(() => null),
    u.procurementAccess !== "none" ? loadProcurements(code).catch(() => []) : Promise.resolve([]),
  ]);
  const indicators = framework?.outcomes.flatMap(function walk(n): { code: string; donorCode: string; name: string; unit: string; achievedThisYear: number; targetThisYear: number; status: string; activity: string }[] {
    return [...n.indicators.map((i) => ({ code: i.code, donorCode: i.donorCode, name: i.name, unit: i.unit, achievedThisYear: i.year, targetThisYear: i.yearTarget, status: i.status, activity: n.key })), ...n.children.flatMap(walk)];
  });
  return {
    today: new Date().toISOString().slice(0, 10),
    asker: { name: u.name, title: u.title, roles: u.project, procurementRoles: u.procurement },
    project: { code, name: project.name, stage: project.stage, start: project.startDate, end: project.endDate, donor: project.donor },
    goal: framework?.goal.text ?? null,
    outcomesAndOutputs: framework?.outcomes.map((o) => ({ code: o.key, statement: o.text ?? o.suggested?.text ?? null, outputs: o.children.map((c) => ({ code: c.key, statement: c.text ?? c.suggested?.text ?? null })) })),
    indicatorsThisYear: indicators ?? [],
    summary: summary ? { headlineYear: summary.year, worthCelebrating: summary.wins.map((w) => `${w.text} (${w.detail})`), needsAttention: summary.concerns.map((c) => ({ level: c.level, what: c.text, why: c.why })) } : null,
    activities: acts?.rows.map((r) => ({ code: r.code, title: r.title, plannedQuarters: r.active, status: r.status, timing: r.timing, owner: r.ownerName, blocker: r.blocker || null, openTasks: r.tasks.filter((t) => !t.done).map((t) => t.title) })) ?? [],
    budget: home?.budget ?? null,
    deadlines: home?.deadlines ?? [],
    waitingForAsker: home?.actions.map((a) => a.text) ?? [],
    openProcurements: procs.filter((p) => p.step !== DONE).map((p) => ({ id: p.id, title: p.title, step: stepById[p.step]?.title ?? p.step, budgetLine: p.plan?.budgetCode ?? p.budgetLine, neededBy: p.neededBy })),
  };
}

export async function ask(code: string, u: AppUser, question: string, history: { q: string; a: string }[]) {
  const facts = await factsFor(code, u);
  const earlier = history.slice(-4).map((h) => `Earlier question: ${h.q}\nYour answer: ${h.a}`).join("\n\n");
  const { out, model } = await draftStructured({
    system: SYSTEM,
    task: `${earlier ? `${earlier}\n\n` : ""}Question from ${u.name}: ${question}`,
    facts,
    schema: answerSchema,
    effort: "medium",
    maxTokens: 6000,
  });
  // Only pages that exist, and at most three.
  const links = out.links.filter((l) => PAGES.includes(l.href.split("#")[0]) || PAGES.includes(l.href.split("?")[0])).slice(0, 3);
  const project = await projectByCode(code);
  await logAudit(db, project.id, { entity: "assistant", entityId: project.id, action: "assistant_asked", by: u.id, detail: { model, question: question.slice(0, 300) } });
  return { answer: out.answer, links, followUps: out.followUps.slice(0, 3) };
}
