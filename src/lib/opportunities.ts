import { z } from "zod";
import { receiptSchema } from "@/lib/expense";

/**
 * Develop: opportunities ROP might pursue, from a donor call, desk or field research, or the
 * team's own experience. Each is framed (the need, the donor's priorities, ROP's capacity, the
 * risks, and the call documents when there are any), gets a match brief (drafted by AI, checked by a person),
 * and ends with a match call by programme management or the executive head. A "no match" keeps
 * its reason, so the next similar opportunity can learn from it.
 */

export const SOURCES = ["Donor call", "Desk research", "Field research", "Team or partner"] as const;
/** What an attached document is: the call itself, or something that comes with it. */
export const DOC_LABELS = ["The call (CFP, RFP, RFA, NOFO or similar)", "Annex or template", "Questions and answers", "Other"] as const;
export const oppDoc = receiptSchema.extend({ label: z.enum(DOC_LABELS), by: z.string().max(40), at: z.string().max(10) });
export type OppDoc = z.infer<typeof oppDoc>;

export type OppStatus = "tracking" | "match" | "no_match" | "designing";

export type MatchBrief = { fromDocuments?: string; summary: string; fit: string; need: string; donorPriorities: string; /** Older briefs only: no longer asked for (owner's decision, 24 Nov 2026). */ grossIncome?: string; capacity: string; risks: string[]; questions: string[]; model: string; at: string; by: string };
export type Opportunity = {
  id: string;
  title: string;
  donor: string;
  source: (typeof SOURCES)[number];
  link: string;
  country: string;
  deadline: string | null;
  value: number | null;
  currency: string;
  need: string;
  donorPriorities: string;
  capacity: string;
  risks: string;
  /** No longer asked for (owner's decision, 24 Nov 2026); older records may still have it. */
  grossIncome?: string;
  /** The team's own notes. */
  notes?: string;
  /** Any contact with the funder: who, when, what was said. */
  funderContact?: string;
  /** The call and its annexes, in the organization's file store. Older records have none. */
  documents?: OppDoc[];
  brief: MatchBrief | null;
  status: OppStatus;
  decision: { match: boolean; reason: string; by: string; byName: string; at: string } | null;
  projectCode: string | null;
  history: { at: string; by: string; byName: string; what: string }[];
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const oppFields = z.object({
  title: z.string().trim().min(3, "Name the opportunity.").max(200),
  donor: z.string().trim().min(2, "Name the donor.").max(120),
  source: z.enum(SOURCES),
  link: z.string().trim().max(600).default(""),
  country: z.string().trim().max(80).default(""),
  deadline: day.nullable().default(null),
  value: z.number().min(0).max(1e10).nullable().default(null),
  currency: z.string().trim().max(5).default("USD"),
  need: z.string().trim().max(4000).default(""),
  donorPriorities: z.string().trim().max(4000).default(""),
  capacity: z.string().trim().max(4000).default(""),
  risks: z.string().trim().max(4000).default(""),
  grossIncome: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(4000).optional(),
  funderContact: z.string().trim().max(4000).optional(),
  documents: z.array(oppDoc).max(8, "Attach up to eight documents.").optional(),
});
export const oppAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), fields: oppFields }),
  z.object({ action: z.literal("edit"), id: z.string(), fields: oppFields }),
  z.object({ action: z.literal("brief"), id: z.string() }),
  /** Read the call (its link or attached documents) and propose the form's fields. Nothing is saved. */
  z.object({ action: z.literal("read"), link: z.string().trim().max(600).default(""), documents: z.array(oppDoc).max(8).default([]) }),
  z.object({ action: z.literal("decide"), id: z.string(), match: z.boolean(), reason: z.string().trim().min(10, "Say why, in a sentence or two: it is kept for next time.").max(2000) }),
  z.object({ action: z.literal("reopen"), id: z.string(), reason: z.string().trim().min(10).max(1000) }),
  z.object({ action: z.literal("designing"), id: z.string(), projectCode: z.string().trim().min(2).max(30) }),
]);
export type OppAction = z.infer<typeof oppAction>;

export const briefSchema = z.object({
  fromDocuments: z.string().describe("What the attached call documents say about eligibility, the deadline, the value and what the donor will fund, in a few sentences. Say plainly if no document was attached."),
  summary: z.string().describe("Two or three sentences: what the opportunity is and the recommendation's main reason, without deciding for the person."),
  fit: z.string().describe("How it fits ROP's model and past projects, naming the closest ones."),
  need: z.string().describe("The need or problem, as the facts state it; say what is missing."),
  donorPriorities: z.string().describe("What the donor wants, from the facts."),
  capacity: z.string().describe("ROP's capacity to deliver: staff, presence, partners, from the facts."),
  risks: z.array(z.string()).describe("The main risks, most serious first."),
  questions: z.array(z.string()).describe("What the team must find out before the match call."),
});

/** Who makes the match call: programme management or the executive head (role types). */
export const MATCH_ROLE_TYPES = ["management", "ceo"] as const;

/** What reading a call proposes for the form. The person checks it before saving. */
export const readSchema = z.object({
  title: z.string().describe("The call's own title, short. Empty if not found."),
  donor: z.string().describe("The funder issuing the call. Empty if not found."),
  deadline: z.string().describe("The application deadline as YYYY-MM-DD. Empty if not found."),
  value: z.number().nullable().describe("The total funding available or the award ceiling, as a number. Null if not found."),
  currency: z.string().describe("The currency code of the value, e.g. USD. Empty if not found."),
  country: z.string().describe("The country or countries where the work would take place. Empty if not found."),
  donorPriorities: z.string().describe("What the funder wants to fund: aims, priorities, who is eligible, in a few plain sentences."),
  need: z.string().describe("The problem the call sets out to address, in a few plain sentences. Empty if the call does not say."),
  missing: z.array(z.string()).describe("Anything a team would need that the call does not say or that could not be read, e.g. 'No deadline found'."),
});
export type CallReading = z.infer<typeof readSchema>;
