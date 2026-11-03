/**
 * Plans and what they unlock. The paid plan has every free feature plus the ones listed here.
 * Check features with `hasFeature`, never by comparing plan names in screens or routes.
 */

export type Plan = "free" | "paid";
export const PLANS: Plan[] = ["free", "paid"];
export const isPlan = (v: unknown): v is Plan => typeof v === "string" && (PLANS as string[]).includes(v);

export const PAID_FEATURES = ["timeline", "ai_assistant", "market_intelligence", "custom_agents"] as const;
export type Feature = (typeof PAID_FEATURES)[number];

export const hasFeature = (plan: Plan, feature: Feature) => plan === "paid" || !(PAID_FEATURES as readonly string[]).includes(feature);

/**
 * The organization's plan. For now set by hand with ORG_PLAN on the server (default free);
 * it moves to the organizations table with billing.
 */
export const serverPlan = (): Plan => (isPlan(process.env.ORG_PLAN) ? process.env.ORG_PLAN : "free");
