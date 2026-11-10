import { withoutNames } from "@/lib/personal-text";

/**
 * Every AI job in the app, in one list. The one door for AI (server/ai.ts) refuses a job that is
 * not here, so a new job starts by adding its line: what it does, whether it writes text for
 * people (then ROP's voice rules are applied for it), and what it looks at, in plain words,
 * which screens show beside a suggestion.
 *
 * AI proposes; a named person confirms. Nothing here is saved as final by the AI.
 */
export type AiJob = {
  /** What the job does, for the audit log and the health page. */
  label: string;
  /** Writes text that people read as ROP's: the voice rules (lib/voice.ts) are added if the prompt lacks them. */
  voice: boolean;
  /** What it looked at, in plain words, shown beside what it proposes. */
  looksAt: string;
};

export const AI_JOBS = {
  translate: { label: "Translate a field note into English", voice: false, looksAt: "the note, title and captions as written in Dari or Pashto" },
  photoCoach: { label: "Coach a photo", voice: false, looksAt: "the photo and its file name" },
  storyDraft: { label: "Draft a success story", voice: true, looksAt: "the interview notes and linked records, with names replaced, and the first name where consent is recorded" },
  assistant: { label: "Answer a question about a project", voice: true, looksAt: "the project's figures, tasks and deadlines, and your question" },
  qprDraft: { label: "Draft quarterly report sections", voice: true, looksAt: "the quarter's accepted results and activity updates, with names replaced" },
  claimCheck: { label: "Check report text against the evidence", voice: false, looksAt: "the report's text, the quarter's accepted results and the weekly updates, with names replaced" },
  monthlyReview: { label: "Draft the monthly review", voice: true, looksAt: "this year's targets and results, the budget and the proposed changes" },
  lensReview: { label: "Review the plan through each lens", voice: true, looksAt: "the plan, its targets, budget by activity and workplan" },
  procurementDraft: { label: "Draft a procurement document", voice: true, looksAt: "the purchase record: item, value, budget line, dates, supplier and signatures" },
  procurementCheck: { label: "Check a procurement step", voice: false, looksAt: "the purchase record: item, value, budget line, dates, supplier and signatures" },
  setupDesign: { label: "Read the agreement and logframe", voice: false, looksAt: "the documents you uploaded" },
  setupTerms: { label: "Read the agreement's reporting dates and rules", voice: false, looksAt: "the agreement you uploaded" },
  setupBudget: { label: "Read a budget document", voice: false, looksAt: "the budget you uploaded" },
  koboSuggest: { label: "Suggest which form question counts toward each target", voice: false, looksAt: "form names, question labels and answer choices, never the answers people gave" },
  spendColumns: { label: "Propose the columns of a spending file", voice: false, looksAt: "the first rows of the file, with name columns blanked" },
  postDraft: { label: "Draft a post from photos", voice: true, looksAt: "the photos' captions and their records, with names replaced" },
  // Opportunities are on the do-not-touch list: the brief's prompt is left exactly as written.
  opportunityBrief: { label: "Draft an opportunity match brief", voice: false, looksAt: "the opportunity's details and the projects' names and stages" },
} as const satisfies Record<string, AiJob>;
export type AiJobName = keyof typeof AI_JOBS;

/**
 * A copy of `value` with people's names and villages replaced in every string found under one of
 * `keys`, at any depth (a list of notes, a record with a `note`, a `note` inside a list of records).
 * Other strings are left as they are: indicator names, places down to the province, codes.
 */
export function scrubKeys(value: unknown, keys: readonly string[], inside = false): unknown {
  if (typeof value === "string") return inside ? withoutNames(value) : value;
  if (Array.isArray(value)) return value.map((v) => scrubKeys(v, keys, inside));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubKeys(v, keys, inside || keys.includes(k))]));
  return value;
}
