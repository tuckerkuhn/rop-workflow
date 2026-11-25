/**
 * Counts of people in plain English, singular for one: "1 woman", "2 women", "1 man", "3 men",
 * "1 young person", "4 young people". The one place reports and screens build these words.
 */

const WORDS = { women: ["woman", "women"], men: ["man", "men"], youth: ["young person", "young people"] } as const;
export type PeopleKind = keyof typeof WORDS;

const plain = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "1 woman", "12 women". `fmt` writes the number (default: 1,234). */
export const peopleCount = (v: number, kind: PeopleKind, fmt: (v: number) => string = plain) => `${fmt(v)} ${WORDS[kind][v === 1 ? 0 : 1]}`;

/** "1 woman, 3 men" (and young people when given), joined with `sep`. */
export function peopleList(p: { women: number; men: number; youth?: number }, sep = ", ", fmt: (v: number) => string = plain) {
  return [peopleCount(p.women, "women", fmt), peopleCount(p.men, "men", fmt), ...(p.youth !== undefined ? [peopleCount(p.youth, "youth", fmt)] : [])].join(sep);
}
