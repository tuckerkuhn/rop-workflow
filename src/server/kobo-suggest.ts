import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { MAPPING_METHODS, type KoboQuestion } from "@/lib/kobo-setup";
import { CONFIDENCE, type Suggestion } from "@/lib/kobo-suggest";
import { draftStructured } from "@/server/ai-structured";
import { projectByCode } from "@/server/field-store";
import { isPersonalQuestion } from "@/server/kobo-protect";
import { koboState, liveQuestions } from "@/server/kobo-link";

/**
 * Suggests, for each indicator, the form, question and way of counting (lib/kobo-suggest). Only the
 * forms' structure goes to the AI: names, question labels, types and choices. Questions that
 * identify a person are left out with their choices. Every suggestion is checked against the
 * forms before it is shown; one that names a form, question or answer that is not there is dropped.
 */

const schema = z.object({
  suggestions: z.array(
    z.object({
      indicator: z.string().describe("The indicator's code, as given."),
      form: z.string().describe("The form's uid, or empty when no question fits."),
      question: z.string().describe("The question's path, or empty."),
      method: z.enum(MAPPING_METHODS).describe("count_answered: each submission that answers it counts one. count_answer: each submission giving one answer counts one (say which in value). count_unique: each distinct answer counts once (e.g. a farmer ID across visits). sum: add up the number in the answer (hectares, people trained in a session)."),
      value: z.string().describe("For count_answer, the choice's name (not its label). Empty otherwise."),
      reason: z.string().describe("Why, in one plain sentence, under 25 words."),
      confidence: z.enum(CONFIDENCE).describe("high: the question clearly records this indicator. medium: probably, but check. low: a guess."),
    }),
  ),
});

const SYSTEM = [
  "You help a programme team say which KoboToolbox question counts toward each indicator of a donor-funded agriculture project.",
  "Use only the forms and questions given. When nothing fits an indicator, return it with an empty form and say so: a wrong mapping counts the wrong thing in a donor report.",
  "Match the unit: an indicator in hectares, kg or money adds up a number question (sum); one counting farmers, events or structures counts submissions, a given answer, or distinct IDs. Prefer a question about the result itself over one about the visit.",
].join(" ");

export async function suggestMappings(code: string): Promise<{ suggestions: Suggestion[]; model: string; questions: Record<string, KoboQuestion[]> }> {
  const project = await projectByCode(code);
  const st = await koboState(code);
  const forms = st.forms.filter((f) => f.purpose !== "readiness");
  const indicators = await db
    .select({ code: s.indicators.code, donorCode: s.indicators.donorCode, name: s.indicators.name, unit: s.indicators.unit })
    .from(s.indicators)
    .where(eq(s.indicators.projectId, project.id))
    .orderBy(asc(s.indicators.position));
  const questions: Record<string, KoboQuestion[]> = {};
  for (const f of forms) questions[f.uid] = (await liveQuestions(code, f.uid)).filter((q) => !isPersonalQuestion(q.path));
  if (!forms.length || !indicators.length) return { suggestions: [], model: "", questions };

  const facts = {
    indicators: indicators.map((i) => ({ code: i.code, donorCode: i.donorCode ?? "", name: i.name, unit: i.unit })),
    forms: forms.map((f) => ({ uid: f.uid, name: f.name, questions: questions[f.uid].map((q) => ({ path: q.path, label: q.label, type: q.type, ...(q.choices.length ? { choices: q.choices.slice(0, 40).map((c) => ({ name: c.name, label: c.label })) } : {}) })) })),
  };
  const { out, model } = await draftStructured({ system: SYSTEM, task: "Suggest one mapping per indicator, every indicator once.", facts, schema, effort: "low", maxTokens: 12000 });

  const byCode = new Map(out.suggestions.map((x) => [x.indicator, x]));
  const suggestions: Suggestion[] = indicators.map((i) => {
    const x = byCode.get(i.code);
    const none = (reason: string): Suggestion => ({ indicatorCode: i.code, mapping: null, reason, confidence: "low" });
    if (!x || !x.form) return none(x?.reason || "No question on the chosen forms records this.");
    const q = questions[x.form]?.find((y) => y.path === x.question);
    if (!q) return none("No question on the chosen forms records this.");
    // A count of one answer needs an answer that is really one of the question's choices.
    if (x.method === "count_answer" && q.choices.length && !q.choices.some((c) => c.name === x.value)) return none("No question on the chosen forms records this.");
    return { indicatorCode: i.code, mapping: { assetUid: x.form, question: q.path, method: x.method, value: x.method === "count_answer" ? x.value || null : null }, reason: x.reason.slice(0, 200), confidence: x.confidence };
  });
  return { suggestions, model, questions };
}
