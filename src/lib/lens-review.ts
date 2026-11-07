import { z } from "zod";

/**
 * The Design-stage lens review: the project plan read through each of ROP's reviewer lenses,
 * returning gaps with a suggestion each. AI drafts the findings; a person decides on every one
 * (act on it, or dismiss it with a reason). Kept as project_state "lens-review".
 */

export const LENSES = [
  { id: "donor", label: "Donor perspective", asks: "Does the plan meet what the donor asked for and will pay for: required indicators, reporting, eligible costs, timing?" },
  { id: "agronomic", label: "Agronomic", asks: "Are the crops, practices, inputs and calendar sound for the place and its water, soil and climate?" },
  { id: "agribusiness", label: "Agribusiness", asks: "Do the businesses supported have a viable model, and is the support (plans, grants, cost share) sized to it?" },
  { id: "market", label: "Market-based", asks: "Is there a buyer and a price for what farmers will produce, at the time they will produce it?" },
  { id: "gender", label: "Gender", asks: "Can women take part and benefit, given local norms, and is that measured with sex-disaggregated targets?" },
  { id: "indigenous", label: "Indigenous and traditional", asks: "Does the plan respect and use local and traditional knowledge, land and water rights?" },
  { id: "underrepresented", label: "Underrepresented groups", asks: "Are returnees, youth, landless and disabled people able to take part, or are they left out by the selection criteria?" },
  { id: "local", label: "Local", asks: "Is the plan grounded in the local context: access, security, local authorities, partners and community ownership?" },
] as const;
export type LensId = (typeof LENSES)[number]["id"];

export const lensDraftSchema = z.object({
  lenses: z
    .array(
      z.object({
        lens: z.enum(LENSES.map((l) => l.id) as [LensId, ...LensId[]]),
        summary: z.string().describe("One or two sentences: how the plan looks through this lens."),
        findings: z
          .array(
            z.object({
              gap: z.string().describe("What is missing or weak, specific to this plan."),
              why: z.string().describe("Why it matters for this project."),
              suggestion: z.string().describe("A concrete change to the plan."),
              severity: z.enum(["high", "medium", "low"]),
            }),
          )
          .describe("At most four, most important first. Empty if the plan holds up through this lens."),
      }),
    )
    .describe("One entry per lens, in the order given."),
  questions: z.array(z.string()).describe("Facts the team must supply before the plan can be judged fully, at most five."),
});
export type LensDraft = z.infer<typeof lensDraftSchema>;

export type Finding = LensDraft["lenses"][number]["findings"][number] & { id: string; decision?: { action: "act" | "dismiss"; note: string; by: string; at: string } };
export type LensReview = {
  at: string;
  by: string;
  model: string;
  lenses: { lens: LensId; summary: string; findings: Finding[] }[];
  questions: string[];
};

export const lensActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("decide"), id: z.string().min(1), decision: z.enum(["act", "dismiss"]), note: z.string().trim().min(5, "Say what will change, or why it does not apply.").max(1000) }),
]);
export type LensAction = z.infer<typeof lensActionSchema>;
