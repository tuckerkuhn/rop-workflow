/**
 * Plans and what they unlock. The paid plan has every free feature plus the ones listed here.
 * Check features with `hasFeature`, never by comparing plan names in screens or routes.
 */

export type Plan = "free" | "paid";
export const PLANS: Plan[] = ["free", "paid"];
export const isPlan = (v: unknown): v is Plan => typeof v === "string" && (PLANS as string[]).includes(v);

/**
 * market_intelligence: production areas, competing supply and (later) contract price data in
 * Project design. The basic market-window calendar, validation and target choice stay free.
 * full_photos: farmer photos at normal phone quality. The free plan keeps a small copy, enough to
 * verify the work, so storage stays low.
 */
export const PAID_FEATURES = ["timeline", "ai_assistant", "market_intelligence", "custom_agents", "full_photos"] as const;
export type Feature = (typeof PAID_FEATURES)[number];

export const hasFeature = (plan: Plan, feature: Feature) => plan === "paid" || !(PAID_FEATURES as readonly string[]).includes(feature);

/**
 * How a farmer photo is kept: resized on the phone before it is saved. Free: 800 pixels on the long
 * side, enough to verify the work (about 50 to 120 KB). Paid (full_photos): 2,000 pixels, normal
 * phone quality (about 300 to 700 KB).
 */
export const PHOTO_QUALITY = { small: { maxEdge: 800, jpeg: 0.6 }, full: { maxEdge: 2000, jpeg: 0.85 } } as const;
/** The largest photo the field save accepts, as saved text: covers a full-quality photo and photos kept before resizing (up to 1.5 MB). */
export const PHOTO_MAX_CHARS = 2_100_000;
