import type { Gender } from "@/lib/field";

/**
 * The household roster (MF-07): each person living in the farmer's household, with sex and age,
 * the farmer included. Kept on the farmer's record (no names), so reports can count the women,
 * men, girls and boys a farmer's work reaches. Written as text the form and a farmer list share:
 * "Female 34, Male 12, Female 3".
 */
export type HouseholdMember = { sex: Gender; age: number };

/** Under 18 is a child (girl or boy). */
export const ADULT_AGE = 18;

const PERSON = /^(female|f|woman|girl|male|m|man|boy)\s*[: ]\s*(\d{1,3})$/i;

/** Reads a roster, or says which person could not be read. Empty text is an empty roster. */
export function parseHousehold(text: string): { members: HouseholdMember[]; problem?: string } {
  const parts = text.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const members: HouseholdMember[] = [];
  for (const [i, p] of parts.entries()) {
    const m = PERSON.exec(p);
    const age = m ? Number(m[2]) : NaN;
    if (!m || age > 120) return { members: [], problem: `person ${i + 1} ("${p}") must be a sex and an age, like "Female 34".` };
    members.push({ sex: /^(f|woman|girl)/i.test(m[1]) ? "Female" : "Male", age });
  }
  if (members.length > 100) return { members: [], problem: "a household of more than 100 people cannot be right." };
  return { members };
}

export const householdText = (members: HouseholdMember[]) => members.map((m) => `${m.sex} ${m.age}`).join(", ");

/** Women, men, girls and boys in a roster. */
export function householdCounts(members: HouseholdMember[]) {
  const c = { women: 0, men: 0, girls: 0, boys: 0, size: members.length };
  for (const m of members) {
    const adult = m.age >= ADULT_AGE;
    if (m.sex === "Female") c[adult ? "women" : "girls"]++;
    else c[adult ? "men" : "boys"]++;
  }
  return c;
}
