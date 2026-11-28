/**
 * The duplicate check at registration and when a farmer list is loaded (MF-08). A farmer ID used
 * twice is refused outright (server/farmers). Two softer signs ask the person to check before saving:
 * - the same phone number, anywhere on the project;
 * - a name that is the same once spelling variants are set aside, in the same village
 *   (Mohammad, Muhammad and Mohamed; Ahmad and Ahmed; first name and family name swapped).
 * Only farmer IDs are shown back: a name is never repeated in the warning.
 */

export type Person = { id: string; village: string; name?: string | null; phone?: string | null };
export type Duplicate = { id: string; other: string; why: "phone" | "name" };

/** Words that are not a name on their own: dropped before comparing. */
const PARTICLES = new Set(["al", "el", "bin", "bint", "ibn", "binti", "abu", "umm", "mr", "mrs", "haji", "hajji"]);

/**
 * One word's sound, roughly: the first letter, then the consonants, with letters that spell the
 * same sound in Latin transliteration made one (k/q/c, f/ph, s/z, j/g before e or i) and doubled
 * letters made single. Vowels, h, w and y vary most between spellings and are left out after the first letter.
 */
export function wordKey(word: string): string {
  let w = word.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  w = w.replace(/ph/g, "f").replace(/ck|q|c(?!h)/g, "k").replace(/kh/g, "k").replace(/z/g, "s").replace(/g(?=[ei])/g, "j").replace(/ou|oo/g, "u").replace(/ee/g, "i");
  const first = /[aeiou]/.test(w[0]) ? "a" : w[0];
  const rest = w.slice(1).replace(/[aeiouhwy]/g, "");
  return (first + rest).replace(/(.)\1+/g, "$1");
}

/** A name's key: its words' keys, sorted, so the order of the words does not matter. */
export function nameKey(name: string): string {
  return name
    .split(/[\s\-'’.]+/)
    .filter((w) => w && !PARTICLES.has(w.toLowerCase()))
    .map(wordKey)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** The last nine digits: +93 70 123 4567 and 0701234567 are one number. */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-9) : "";
}

const villageKey = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Each new farmer who may be someone already registered, or someone earlier on the same list.
 * A farmer already registered under the same ID is the same person being updated, not a duplicate.
 */
export function possibleDuplicates(incoming: Person[], registered: Person[]): Duplicate[] {
  const out: Duplicate[] = [];
  const seen: Person[] = [...registered];
  const known = new Set(registered.map((r) => r.id.toUpperCase()));
  for (const p of incoming) {
    // Already registered under this ID: the list updates them, and they were checked when added.
    if (known.has(p.id.toUpperCase())) continue;
    const phone = p.phone ? phoneKey(p.phone) : "";
    const name = p.name ? nameKey(p.name) : "";
    const village = villageKey(p.village);
    for (const q of seen) {
      if (q.id.toUpperCase() === p.id.toUpperCase()) continue;
      if (phone && q.phone && phoneKey(q.phone) === phone) out.push({ id: p.id, other: q.id, why: "phone" });
      else if (name && q.name && villageKey(q.village) === village && nameKey(q.name) === name) out.push({ id: p.id, other: q.id, why: "name" });
    }
    seen.push(p);
  }
  return out;
}

/** "F-1005 has the same phone as F-1001; F-1006 has a similar name to F-1002 in the same village." */
export function duplicatesText(d: Duplicate[]): string {
  const shown = d.slice(0, 10).map((x) => (x.why === "phone" ? `${x.id} has the same phone number as ${x.other}` : `${x.id} has a name like ${x.other}'s, in the same village`));
  return `${shown.join("; ")}${d.length > 10 ? `; and ${d.length - 10} more` : ""}.`;
}
