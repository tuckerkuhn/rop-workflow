import type { ResultRecord } from "@/lib/results";

/** Synthetic data only. No real person, place of residence or project figure appears here. */

export const hashOf = (seed: string) => seed.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");

export const file = (seed: string, type = "application/pdf") => ({ hash: hashOf(seed), name: `${seed}.pdf`, type, size: 1000 });

let next = 0;
/** A recorded result for the sandbox project; accepted with one proof file unless told otherwise. */
export function result(over: Partial<ResultRecord> = {}): ResultRecord {
  next += 1;
  const date = over.date ?? "2026-08-15";
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    indicator: "IND-1",
    date,
    value: 10,
    note: "Synthetic test record for the sandbox project.",
    files: [file(`f${next}`)],
    quarter: `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`,
    status: "accepted",
    by: "Test Recorder",
    at: `${date}T08:00:00Z`,
    reviewedBy: "Test Reviewer",
    reviewedAt: `${date}T09:00:00Z`,
    query: null,
    ...over,
  };
}
