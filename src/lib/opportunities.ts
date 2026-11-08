import { z } from "zod";

/**
 * Develop: opportunities ROP might pursue, from a donor call, desk or field research, or the
 * team's own experience. Each is framed (the need, the donor's priorities, ROP's capacity, the
 * risks, the 50% gross income analysis), gets a match brief (drafted by AI, checked by a person),
 * and ends with a match call by programme management or the executive head. A "no match" keeps
 * its reason, so the next similar opportunity can learn from it.
 */

export const SOURCES = ["Donor call", "Desk research", "Field research", "Team or partner"] as const;
export type OppStatus = "tracking" | "match" | "no_match" | "designing";

export type MatchBrief = { summary: string; fit: string; need: string; donorPriorities: string; grossIncome: string; capacity: string; risks: string[]; questions: string[]; model: string; at: string; by: string };
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
  /** The 50% gross income analysis, in the team's words and figures. */
  grossIncome: string;
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
  grossIncome: z.string().trim().max(2000).default(""),
});
export const oppAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), fields: oppFields }),
  z.object({ action: z.literal("edit"), id: z.string(), fields: oppFields }),
  z.object({ action: z.literal("brief"), id: z.string() }),
  z.object({ action: z.literal("decide"), id: z.string(), match: z.boolean(), reason: z.string().trim().min(10, "Say why, in a sentence or two: it is kept for next time.").max(2000) }),
  z.object({ action: z.literal("reopen"), id: z.string(), reason: z.string().trim().min(10).max(1000) }),
  z.object({ action: z.literal("designing"), id: z.string(), projectCode: z.string().trim().min(2).max(30) }),
]);
export type OppAction = z.infer<typeof oppAction>;

export const briefSchema = z.object({
  summary: z.string().describe("Two or three sentences: what the opportunity is and the recommendation's main reason, without deciding for the person."),
  fit: z.string().describe("How it fits ROP's model and past projects, naming the closest ones."),
  need: z.string().describe("The need or problem, as the facts state it; say what is missing."),
  donorPriorities: z.string().describe("What the donor wants, from the facts."),
  grossIncome: z.string().describe("The 50% gross income analysis, from the team's figures; say plainly if they are missing."),
  capacity: z.string().describe("ROP's capacity to deliver: staff, presence, partners, from the facts."),
  risks: z.array(z.string()).describe("The main risks, most serious first."),
  questions: z.array(z.string()).describe("What the team must find out before the match call."),
});

/** Who makes the match call: programme management or the executive head (role types). */
export const MATCH_ROLE_TYPES = ["management", "ceo"] as const;
