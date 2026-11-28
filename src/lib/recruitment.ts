import { z } from "zod";
import type { Entry, HrState } from "@/lib/hr";

/**
 * Recruitment (review round 1, MF-05, decisions D-16 to D-18), kept light. A vacancy is advertised
 * for at least 14 days. Every candidate declares whether they are related to anyone on the staff.
 * Every CV is graded. A shortlist of 3 to 5 is interviewed by a panel of 3 or 4 staff at or above the
 * post's grade; HR runs the process and does not score. References are taken after the interviews,
 * for finalists only. A selection memo names the person chosen and, when it is not the top score,
 * why. Then the hire goes through the HR record's own approval by grade (a "hire" change), which
 * opens onboarding.
 *
 * Entries in the HR ledger (HR only, except the panel's own scores): "rec-open", "rec-candidate",
 * "rec-grade", "rec-shortlist", "rec-score", "rec-reference", "rec-select".
 */

export const MIN_OPEN_DAYS = 14;
export const SHORTLIST = { min: 3, max: 5 } as const;
export const PANEL = { min: 3, max: 4 } as const;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().regex(/^[a-z0-9-]{2,40}$/);
export const recActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), title: z.string().trim().min(2).max(200), grade: z.number().int().min(1).max(20), office: z.string().trim().min(2).max(100), opened: iso, closes: iso, panel: z.array(id).min(PANEL.min).max(PANEL.max) }),
  z.object({ action: z.literal("candidate"), vacancy: z.number().int().positive(), name: z.string().trim().min(2).max(200), related: z.string().trim().max(300), received: iso }),
  z.object({ action: z.literal("grade"), vacancy: z.number().int().positive(), candidate: z.number().int().positive(), score: z.number().int().min(1).max(5), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("shortlist"), vacancy: z.number().int().positive(), candidates: z.array(z.number().int().positive()).min(SHORTLIST.min).max(SHORTLIST.max) }),
  z.object({ action: z.literal("score"), vacancy: z.number().int().positive(), candidate: z.number().int().positive(), score: z.number().min(0).max(100) }),
  z.object({ action: z.literal("reference"), vacancy: z.number().int().positive(), candidate: z.number().int().positive(), from: z.string().trim().min(2).max(200), summary: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("select"), vacancy: z.number().int().positive(), candidate: z.number().int().positive(), memo: z.string().trim().min(20, "Write the selection memo: who, and why.").max(4000), deviation: z.string().trim().max(1000).optional() }),
]);
export type RecAction = z.infer<typeof recActionSchema>;

export type Candidate = { n: number; name: string; related: string; received: string; cvGrade?: number; scores: Record<string, number>; references: { from: string; summary: string; by: string }[] };
export type Vacancy = {
  n: number;
  title: string;
  grade: number;
  office: string;
  opened: string;
  closes: string;
  panel: string[];
  by: string;
  candidates: Candidate[];
  shortlist: number[];
  selected?: { candidate: number; memo: string; deviation?: string; by: string; at: string };
};
export type RecIgnored = { n: number; kind: string; why: string };

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const isHr = (u: string, hr: HrState) => !!hr.rules?.holders.hr.includes(u);
/** A person's grade from their HR record, or null when it is not recorded. */
const gradeOf = (p: string, hr: HrState) => {
  const g = hr.people[p]?.current.grade;
  return typeof g === "number" ? g : null;
};

/** The average panel score of a shortlisted candidate, once every panel member has scored. */
export const panelScore = (v: Vacancy, c: Candidate) => (v.panel.every((m) => typeof c.scores[m] === "number") ? Math.round((v.panel.reduce((t, m) => t + c.scores[m], 0) / v.panel.length) * 10) / 10 : null);

/** Why this panel cannot sit for this post, or null: 3 or 4 staff at or above its grade, none of them HR. */
export function panelProblem(panel: string[], grade: number, hr: HrState): string | null {
  if (panel.length < PANEL.min || panel.length > PANEL.max) return `A panel has ${PANEL.min} or ${PANEL.max} members.`;
  const hrOnPanel = panel.find((m) => isHr(m, hr));
  if (hrOnPanel) return "HR runs the process and does not score: take HR off the panel.";
  const missing = panel.find((m) => gradeOf(m, hr) === null);
  if (missing) return `Record ${missing}'s grade in the HR record first: the panel sits at or above the post's grade.`;
  const low = panel.find((m) => (gradeOf(m, hr) ?? 0) < grade);
  if (low) return `${low} is below the post's grade (${grade}): the panel sits at or above it.`;
  return null;
}

export function foldRecruitment(entries: Entry[], hr: HrState): { vacancies: Vacancy[]; ignored: RecIgnored[] } {
  const vacancies = new Map<number, Vacancy>();
  const ignored: RecIgnored[] = [];
  const no = (e: Entry, why: string) => ignored.push({ n: e.n, kind: e.kind, why });
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (!e.kind.startsWith("rec-")) continue;
    const parsed = recActionSchema.safeParse({ ...(e.data as object), action: e.kind.slice(4) });
    if (!parsed.success) {
      no(e, "unreadable");
      continue;
    }
    const a = parsed.data;
    if (a.action === "open") {
      if (!isHr(e.actor, hr)) no(e, "HR opens a vacancy");
      else if (days(a.opened, a.closes) < MIN_OPEN_DAYS) no(e, `a vacancy is open at least ${MIN_OPEN_DAYS} days`);
      else if (panelProblem(a.panel, a.grade, hr)) no(e, panelProblem(a.panel, a.grade, hr)!);
      else vacancies.set(e.n, { n: e.n, title: a.title, grade: a.grade, office: a.office, opened: a.opened, closes: a.closes, panel: a.panel, by: e.actor, candidates: [], shortlist: [] });
      continue;
    }
    const v = vacancies.get(a.vacancy);
    if (!v) {
      no(e, "no such vacancy");
      continue;
    }
    if (v.selected) {
      no(e, "the vacancy is already filled");
      continue;
    }
    const c = "candidate" in a && typeof a.candidate === "number" ? v.candidates.find((x) => x.n === a.candidate) : undefined;
    if (a.action === "candidate") {
      if (!isHr(e.actor, hr)) no(e, "HR records applications");
      else v.candidates.push({ n: e.n, name: a.name, related: a.related, received: a.received, scores: {}, references: [] });
    } else if (a.action === "shortlist") {
      // Shortlisting needs every CV graded, after the vacancy closes.
      if (!isHr(e.actor, hr)) no(e, "HR records the shortlist");
      else if (e.at.slice(0, 10) < v.closes) no(e, `the vacancy is open until ${v.closes}`);
      else if (v.candidates.some((x) => x.cvGrade === undefined)) no(e, "every CV is graded first");
      else v.shortlist = a.candidates.filter((n) => v.candidates.some((x) => x.n === n));
    } else if (!c) no(e, "no such candidate");
    else if (a.action === "grade") {
      if (!isHr(e.actor, hr)) no(e, "HR grades the CVs");
      else c.cvGrade = a.score;
    } else if (a.action === "score") {
      if (!v.panel.includes(e.actor)) no(e, "only the panel scores");
      else if (!v.shortlist.includes(c.n)) no(e, "only shortlisted candidates are interviewed");
      else c.scores[e.actor] = a.score;
    } else if (a.action === "reference") {
      if (!isHr(e.actor, hr)) no(e, "HR takes references");
      else if (panelScore(v, c) === null) no(e, "references come after the interviews, for finalists only");
      else c.references.push({ from: a.from, summary: a.summary, by: e.actor });
    } else if (a.action === "select") {
      const top = [...v.shortlist].map((n) => v.candidates.find((x) => x.n === n)!).sort((x, y) => (panelScore(v, y) ?? -1) - (panelScore(v, x) ?? -1))[0];
      if (!isHr(e.actor, hr)) no(e, "HR writes the selection memo");
      else if (panelScore(v, c) === null) no(e, "every panel member scores the chosen candidate first");
      else if (!c.references.length) no(e, "a reference is taken for the chosen candidate first");
      else if (top && top.n !== c.n && !(a.deviation ?? "").trim()) no(e, "the chosen candidate is not the top score: say why");
      else v.selected = { candidate: c.n, memo: a.memo, ...(a.deviation ? { deviation: a.deviation } : {}), by: e.actor, at: e.at };
    }
  }
  return { vacancies: [...vacancies.values()], ignored };
}
