import type { KoboMapping, KoboQuestion } from "@/lib/kobo-setup";

/**
 * Suggested mappings from KoboToolbox questions to indicators (A4), and the risks code checks in
 * them. The AI sees only form names, question labels, types and choices, and the indicators'
 * names, units and donor codes: never a submission or an answer. People accept each suggestion.
 */

export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export type Suggestion = {
  indicatorCode: string;
  /** Null: no good match on the chosen forms; the indicator stays unmapped. */
  mapping: Omit<KoboMapping, "indicatorCode" | "origin"> | null;
  reason: string;
  confidence: Confidence;
};

/** Units that are measured (summed from a number), not counted. */
const MEASURED = /^(ha|hectares?|jeribs?|kg|kilograms?|tons?|tonnes?|mt|t|usd|\$|afn|dollars?|afghanis?|m|m2|m²|km|metres?|meters?|square metres?|litres?|liters?|l|cubic metres?|m3|%|percent)$/i;
const NUMERIC = /^(integer|decimal|range|calculate)$/;

export type Risk = { indicatorCode: string; kind: "shared" | "unit"; text: string };

/** One question counted toward two indicators the same way, and units that do not fit how a question is counted. */
export function mappingRisks(mappings: KoboMapping[], questions: Record<string, KoboQuestion[]>, indicators: { code: string; name: string; unit: string }[]): Risk[] {
  const out: Risk[] = [];
  const name = (c: string) => indicators.find((i) => i.code === c)?.name ?? c;
  const seen = new Map<string, string>();
  for (const m of mappings) {
    if (!m.question) continue;
    const k = `${m.assetUid}|${m.question}|${m.method}|${m.value ?? ""}`;
    const other = seen.get(k);
    if (other) out.push({ indicatorCode: m.indicatorCode, kind: "shared", text: `Counts the same question, the same way, as "${name(other)}": each submission would count toward both.` });
    else seen.set(k, m.indicatorCode);
    const unit = (indicators.find((i) => i.code === m.indicatorCode)?.unit ?? "").trim();
    const q = questions[m.assetUid]?.find((x) => x.path === m.question);
    const numeric = q ? NUMERIC.test(q.type) : null;
    if (m.method === "sum" && numeric === false) out.push({ indicatorCode: m.indicatorCode, kind: "unit", text: `Adds up a ${q!.type.replace(/_/g, " ")} question, which holds no number.` });
    else if (MEASURED.test(unit) && m.method !== "sum") out.push({ indicatorCode: m.indicatorCode, kind: "unit", text: `Measured in ${unit}, but counts submissions instead of adding up the ${unit} each one records.` });
  }
  return out;
}
