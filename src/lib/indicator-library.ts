import type { MessageKey } from "@/lib/i18n";

/**
 * ROP's four impact themes and a small library of standard impact indicators for each. A
 * project's indicators can be tagged with a theme in setup, and the library adds a ready-made
 * indicator with its theme, level and reporting frequency; the team then sets the targets.
 */

export const THEMES = ["Net income", "Resilience", "Environment", "Equity"] as const;
export type ImpactTheme = (typeof THEMES)[number];

export const THEME_LABEL: Record<ImpactTheme, MessageKey> = {
  "Net income": "theme.income",
  Resilience: "theme.resilience",
  Environment: "theme.environment",
  Equity: "theme.equity",
};

type Level = "goal" | "outcome" | "output";
type Frequency = "monthly" | "quarterly" | "end_of_season";

export const LIBRARY: { theme: ImpactTheme; name: MessageKey; unit: MessageKey; level: Level; frequency: Frequency }[] = [
  { theme: "Net income", name: "lib.income.net", unit: "setup.unit.pct", level: "goal", frequency: "end_of_season" },
  { theme: "Net income", name: "lib.income.households", unit: "setup.unit.households", level: "outcome", frequency: "end_of_season" },
  { theme: "Resilience", name: "lib.resilience.second", unit: "setup.unit.households", level: "outcome", frequency: "end_of_season" },
  { theme: "Resilience", name: "lib.resilience.practices", unit: "setup.unit.farmers", level: "outcome", frequency: "end_of_season" },
  { theme: "Environment", name: "lib.environment.conserving", unit: "setup.unit.hectares", level: "outcome", frequency: "end_of_season" },
  { theme: "Environment", name: "lib.environment.water", unit: "setup.unit.pct", level: "outcome", frequency: "end_of_season" },
  { theme: "Equity", name: "lib.equity.women", unit: "setup.unit.share", level: "outcome", frequency: "quarterly" },
  { theme: "Equity", name: "lib.equity.womenled", unit: "setup.unit.businesses", level: "output", frequency: "quarterly" },
];
