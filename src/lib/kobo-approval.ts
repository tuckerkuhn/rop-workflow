/**
 * Who approves what arrives from KoboCollect, before it reaches anything else in the app. One
 * choice per project, used in the three places a KoboToolbox record is let through: a result made
 * from a form (Results), a field record in the review queue (readiness and the like), and an input
 * distribution on its way to the project manager.
 *
 * Until a project chooses, the rule is the one the app always had: anyone with the MEL role.
 */

export type KoboApproval = {
  who: "mel" | "named" | "manager";
  /** With "named": the one person who approves (for example the Director of MEL), by person id. */
  person?: string;
  /** With "named": who approves when that person is away. */
  standIn?: string;
};

export const DEFAULT_KOBO_APPROVAL: KoboApproval = { who: "mel" };
export const KOBO_APPROVAL_KEY = "kobo-approval";

export const KOBO_APPROVAL_OPTIONS: { id: KoboApproval["who"]; label: string; help: string }[] = [
  { id: "mel", label: "Anyone with the MEL role", help: "Fastest, and how the app has worked so far. A MEL officer who collected the data in KoboCollect can also be the one who approves it." },
  { id: "named", label: "One named person, with a stand-in", help: "For example the Director of MEL. Nothing from KoboCollect moves until they, or their stand-in, have looked. Choose people who do not collect in the field themselves." },
  { id: "manager", label: "The project manager", help: "One check instead of two for input distributions. The project manager also approves results and readiness checks that come from KoboCollect." },
];

type Person = { id: string; name: string; kind?: string; field: string[]; project: string[] };

/** Whether this person approves KoboCollect data under the project's rule. */
export function mayApproveKobo(u: Pick<Person, "id" | "field" | "project">, rule: KoboApproval): boolean {
  if (rule.who === "named") return !!rule.person && (u.id === rule.person || (!!rule.standIn && u.id === rule.standIn));
  if (rule.who === "manager") return u.field.includes("manager");
  return u.project.includes("mel-owner");
}

/** The people who approve KoboCollect data on this project, the named person before their stand-in. */
export function koboApprovers<P extends Person>(people: P[], rule: KoboApproval): P[] {
  const list = people.filter((p) => mayApproveKobo(p, rule));
  return rule.who === "named" ? list.sort((a, b) => Number(b.id === rule.person) - Number(a.id === rule.person)) : list;
}

/** "Omar Sadiq or Nadia Rahimi", or the role when nobody holds it yet. */
export function approverNames(people: Person[], rule: KoboApproval): string {
  const names = koboApprovers(people, rule).map((p) => p.name);
  if (!names.length) return rule.who === "manager" ? "the project manager" : rule.who === "named" ? "the person named to approve KoboCollect data" : "someone with the MEL role";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** What is wrong with a rule, in words the person setting it can act on; null when it can be saved. */
export function koboApprovalProblem(rule: KoboApproval, people: Person[]): string | null {
  if (rule.who !== "named") return null;
  const staff = (id?: string) => people.find((p) => p.id === id && (p.kind ?? "employee") === "employee");
  if (!rule.person) return "Choose the person who approves KoboCollect data.";
  if (!staff(rule.person)) return "The person chosen is not on the staff list.";
  if (rule.standIn && !staff(rule.standIn)) return "The stand-in chosen is not on the staff list.";
  if (rule.standIn && rule.standIn === rule.person) return "The stand-in has to be a different person.";
  return null;
}

/**
 * Whether an input distribution from KoboCollect still needs its check before the project manager
 * can approve it. When the project manager is the one who approves KoboCollect data, their
 * approval is the check, so there is no second step.
 */
export const needsKoboCheck = (d: { source: string; koboChecked?: unknown }, rule: KoboApproval) => d.source === "kobo" && rule.who !== "manager" && !d.koboChecked;

/** Who decides a record: the project's KoboCollect approver when it came from a form, MEL otherwise. */
export function mayDecide(u: Pick<Person, "id" | "field" | "project">, fromKobo: boolean, rule: KoboApproval): boolean {
  return fromKobo ? mayApproveKobo(u, rule) : u.project.includes("mel-owner");
}
