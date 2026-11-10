/**
 * Names in free text (data protection review, November 2026). Field notes often name a farmer and
 * their village ("Matiullah's fig orchard in Sardagh Village"). The forms warn when a note seems to,
 * and text sent to the AI has such names replaced. English only: names written in Dari or Pashto
 * script are not caught by these rules. A guard, not a guarantee.
 */

/** Places, organizations and common words that look like names but are not people's ("Women's groups", "Today's training"). */
const NOT_PEOPLE = new Set(
  "ROP UNDP FAO IOM WFP AKDN ACRP ARLP Afghanistan Afghan Kandahar Helmand Kabul Herat Balkh Nangarhar Parwan Maiwand Nesh Sangin Musa Qala Grishk Arghandab Zhari Panjwai Dand Daman Lashkar Gah Nad Ali Nawa Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Roots Peace Saudi India China Dubai Expo Food Show Center Province District Women Men Farmers Farmer People Children Youth Girls Boys Families Family Traders Trader Growers Grower Members Member Team Project Donor Government Ministry Company Cooperative Association Group Committee Today Yesterday Tomorrow Year Quarter Month Week Season".split(" "),
);

const POSSESSIVE = /\b((?:[A-Z][a-z]{2,})(?:[ -][A-Z][a-z]{2,})?)['’]s\b/g;
const VILLAGE = /\b([A-Z][a-z]{2,}(?:[ -][A-Z][a-z]{2,})?)\s+(Village|Kalay|Kalai|Kili|Qarya|Qaryeh)\b/g;
const TITLED = /\b(Haji|Hajji|Mullah|Mawlawi|Sayed|Sayyid|Mr\.?|Mrs\.?|Ms\.?|Eng\.?)\s+([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?)/g;

const isPlace = (s: string) => s.split(/[ -]/).every((w) => NOT_PEOPLE.has(w));

/** What in a note looks like a person's name or their village, for the form's warning. */
export function namesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(POSSESSIVE)) if (!isPlace(m[1])) out.add(`${m[1]}'s`);
  for (const m of text.matchAll(VILLAGE)) if (!isPlace(m[1])) out.add(`${m[1]} ${m[2]}`);
  for (const m of text.matchAll(TITLED)) out.add(`${m[1]} ${m[2]}`);
  return [...out];
}

/** The text with people's names and villages replaced, for sending to the AI. */
export function withoutNames(text: string): string {
  return text
    .replace(TITLED, "a farmer")
    .replace(VILLAGE, (all, name: string) => (isPlace(name) ? all : "a village"))
    .replace(POSSESSIVE, (all, name: string) => (isPlace(name) ? all : "a farmer's"));
}
