import { z } from "zod";

/**
 * The results framework as a tree: goal → outcomes → outputs → activities → indicators and ROP's
 * sub-activities. The tree's shape comes from the donor's codes ("1.2.1.4": outcome 1, output 1.2,
 * activity 1.2.1); the wording of each level is kept per project, with where it came from.
 */

export type Statement = { text: string; source: string; by: string; byName: string; at: string };
export type Framework = { goal: Statement | null; nodes: Record<string, Statement> };
export const EMPTY_FRAMEWORK: Framework = { goal: null, nodes: {} };
/** The project_state key the framework's wording is saved under. */
export const FRAMEWORK_KEY = "framework";

export const frameworkAction = z.object({
  /** "goal", or a node code: "1" (outcome), "1.2" (output), "1.2.1" (activity). */
  key: z.string().regex(/^(goal|\d+(\.\d+){0,2})$/, "Not a level of the framework."),
  text: z.string().trim().min(5, "Write the statement.").max(1000),
  source: z.string().trim().min(3, "Say where the wording comes from (document and page).").max(300),
});
export type FrameworkAction = z.infer<typeof frameworkAction>;

/** Levels by depth of the code. */
export const levelOf = (key: string) => (key === "goal" ? "Goal" : ["Outcome", "Output", "Activity"][key.split(".").length - 1]);
/** The parent codes of a donor code: "1.2.1.4-a" → ["1", "1.2", "1.2.1"]. */
export const ancestors = (code: string) => {
  const parts = code.replace(/-[a-z]$/i, "").split(".");
  return [1, 2, 3].filter((n) => parts.length > n || (n === 3 && parts.length === 3)).map((n) => parts.slice(0, n).join("."));
};

/** Wording read from signed project documents, offered for a person to accept. */
export const SUGGESTED: Record<string, Record<string, { text: string; source: string }>> = {
  "ACRP-2026": {
    goal: { text: "Mitigate the adverse effects of the poppy cultivation ban while addressing the impacts of rapid and slow onset climate change on people's lives, livelihoods, and the risks of displacement and return.", source: "UNDP Responsible Party Agreement, March 2025, Project Objectives p32" },
    "1": { text: "Increased economic resilience through sustainable and diversified livelihoods", source: "UNDP Responsible Party Agreement, March 2025, p32" },
    "2": { text: "Enhanced water resources and ecosystem management", source: "UNDP Responsible Party Agreement, March 2025, p32" },
    "3": { text: "Enhanced community resilience from climate and disaster risks", source: "UNDP Responsible Party Agreement, March 2025, p32" },
    "1.1": { text: "Improved climate-resilient agricultural production and productivity of smallholder farmers and livestock herders", source: "UNDP Responsible Party Agreement, March 2025, Expected Outputs" },
    "1.2": { text: "Improved access to market, value addition and MSME support", source: "UNDP Responsible Party Agreement, March 2025, Expected Outputs" },
    "2.1": { text: "Improved understanding of communities on integrated water resources management (IWRM) with the use of balanced surface and groundwater", source: "UNDP Responsible Party Agreement, March 2025, Expected Outputs" },
  },
};
