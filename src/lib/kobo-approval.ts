/**
 * Who approves what arrives from KoboCollect, before it reaches anything else in the app. One
 * choice per project, used in the three places a KoboToolbox record is let through: a result made
 * from a form (Results), a field record in the review queue (readiness and the like), and an input
 * distribution on its way to the project manager.
 *
 * A project with nothing saved (those made before 17 Nov 2026) keeps the rule the app always had:
 * anyone with the MEL role. A new project starts with one named person (NEW_PROJECT_KOBO_APPROVAL).
 */

export type KoboApproval = {
  who: "mel" | "named" | "manager";
  /** With "named": the one person who approves (for example the Director of MEL), by person id. */
  person?: string;
  /** With "named": who approves when that person is away. */
  standIn?: string;
  /**
   * Whose KoboCollect account is whose: Kobo account name to person id. Every submission carries
   * the account that sent it, so with this the app knows who collected a record and can make sure
   * someone else approves it.
   */
  accounts?: Record<string, string>;
};

export const DEFAULT_KOBO_APPROVAL: KoboApproval = { who: "mel" };
/**
 * What a project made from now on starts with: one named person, still to be chosen. Until someone
 * is named nothing from KoboCollect is approved by a group; a record falls to the person its
 * collector reports to. Projects that already exist keep the rule they have.
 */
export const NEW_PROJECT_KOBO_APPROVAL: KoboApproval = { who: "named" };
export const KOBO_APPROVAL_KEY = "kobo-approval";

export const KOBO_APPROVAL_OPTIONS: { id: KoboApproval["who"]; label: string; help: string }[] = [
  { id: "mel", label: "Anyone with the MEL role", help: "Fastest, and how the app has worked so far. A MEL officer who collected the data in KoboCollect can also be the one who approves it." },
  { id: "named", label: "One named person, with a stand-in", help: "For example the Director of MEL. Nothing from KoboCollect moves until they, or their stand-in, have looked. Choose people who do not collect in the field themselves." },
  { id: "manager", label: "The project manager", help: "One check instead of two for input distributions. The project manager also approves results and readiness checks that come from KoboCollect." },
];

type Person = { id: string; name: string; kind?: string; email?: string; reportsTo?: string; field: string[]; project: string[] };

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
  if (!names.length) return rule.who === "manager" ? "the project manager" : rule.who === "named" ? (rule.person ? "the person named to approve KoboCollect data" : "nobody yet: name the person who approves KoboCollect data in Set up") : "someone with the MEL role";
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

/* ---------- nobody approves what they collected ---------- */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The person who collected a record, from the KoboCollect account that sent it: the match the
 * project saved, or else the person whose full sign-in email the account is. Null when the account
 * is unknown, and then the app cannot tell who collected. An account named only like the start of
 * an email ("omar", "admin") is never matched by itself: see suggestedCollector.
 */
export function collectorOf(account: string | null | undefined, rule: KoboApproval, people: Person[]): string | null {
  if (!account?.trim()) return null;
  const saved = Object.entries(rule.accounts ?? {}).find(([name]) => same(name, account))?.[1];
  if (saved) return people.some((p) => p.id === saved) ? saved : null;
  return people.find((p) => p.email && same(p.email, account))?.id ?? null;
}

/**
 * Who an account probably belongs to, for a person to confirm on the setup screen: the one person
 * whose sign-in email starts with the account name. Null when none or more than one does.
 */
export function suggestedCollector(account: string, people: Person[]): string | null {
  const hits = people.filter((p) => p.email && same(p.email.split("@")[0], account));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * `fromKobo`: the record is field data, collected on a phone (KoboCollect, or a field form filled in
 * inside the app), so the project's named approver checks it before it flows on (review round 1,
 * Part 2 step 3). False for a result typed into the app, which MEL checks as before.
 */
type Rec = { fromKobo: boolean; /** Who collected or recorded it (person id), when known. */ collector: string | null };

/**
 * A stored record's place in the approval rule. From KoboCollect, the collector is the person the
 * account belongs to; from a form filled in inside the app, the person signed in (`by`), and it is
 * field data all the same; anything else is a record typed into the app.
 */
export function fieldRec(r: { source: string | null | undefined; by: string | null | undefined; appForm?: boolean }, rule: KoboApproval, people: Person[]): Rec {
  if (r.source === "kobo") return { fromKobo: true, collector: collectorOf(r.by, rule, people) };
  return { fromKobo: !!r.appForm || r.source === "form", collector: r.by ?? null };
}

/**
 * The people who may decide a record. It starts from the usual group (the project's KoboCollect
 * approvers for a record from a phone, the MEL role for one typed into the app) and takes out
 * whoever collected it: nobody approves their own work. When that leaves nobody, as with a team
 * of one MEL officer, it goes to the person the collector reports to.
 */
export function decidersOf<P extends Person>(people: P[], rec: Rec, rule: KoboApproval): P[] {
  const usual = (rec.fromKobo ? koboApprovers(people, rule) : people.filter((p) => p.project.includes("mel-owner"))).filter((p) => p.id !== rec.collector);
  if (usual.length || !rec.collector) return usual;
  const boss = people.find((p) => p.id === people.find((c) => c.id === rec.collector)?.reportsTo);
  return boss ? [boss] : [];
}

export const mayDecideRecord = (u: Pick<Person, "id">, people: Person[], rec: Rec, rule: KoboApproval) => decidersOf(people, rec, rule).some((p) => p.id === u.id);

/** "Nadia Rahimi", "Omar Sadiq or Karim Ahmadi", or what to do when nobody can. */
export function deciderNames(people: Person[], rec: Rec, rule: KoboApproval): string {
  const names = decidersOf(people, rec, rule).map((p) => p.name);
  if (!names.length) return "nobody yet (name a second approver, or set who the collector reports to in the staff list)";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Why this person may not decide this record, in words; null when they may. */
export function refusalFor(u: Pick<Person, "id">, people: Person[], rec: Rec, rule: KoboApproval): string | null {
  if (mayDecideRecord(u, people, rec, rule)) return null;
  const who = deciderNames(people, rec, rule);
  if (rec.collector === u.id) return `You collected this record, so someone else decides it: ${who}.`;
  return rec.fromKobo ? `This is field data. On this project ${who} checks it before it is used anywhere else.` : `Only ${who} can accept or query this record.`;
}

/* ---------- the technical lead sends field work back ---------- */

/** The field forms in the review queue: a readiness check, training attendance, a farm visit. */
export const FIELD_FORMS = ["readiness", "training", "visit"] as const;
export const isFieldForm = (form: string | null | undefined) => (FIELD_FORMS as readonly string[]).includes(form ?? "");

/**
 * The technical lead (a senior agronomist) reads the field work, so they may send a field form back
 * for correction with a note. They never accept one (accepting counts results: that stays with the
 * people the project's rule names) and never act on a distribution (the project manager approves
 * those). Only on a project they are on, and never a record they collected themselves.
 */
export function maySendBack(u: Pick<Person, "id" | "project">, people: Person[], rec: Rec & { form: string | null | undefined }): boolean {
  return u.project.includes("technical-lead") && isFieldForm(rec.form) && people.some((p) => p.id === u.id) && rec.collector !== u.id;
}

/**
 * Why this person may not make this decision on a record in the review queue, in words; null when
 * they may. The usual rule (refusalFor) first; then the technical lead's narrower one: sending a
 * field form back, with a note.
 */
export function reviewRefusal(u: Pick<Person, "id" | "project">, people: Person[], rec: Rec & { form: string | null | undefined }, rule: KoboApproval, status: "accepted" | "queried", note?: string | null): string | null {
  const usual = refusalFor(u, people, rec, rule);
  if (!usual) return null;
  if (!u.project.includes("technical-lead") || !people.some((p) => p.id === u.id)) return usual;
  if (rec.form === "distribution") return "The project manager approves input distributions. You can read them, but not approve or send them back.";
  if (!isFieldForm(rec.form)) return usual;
  if (rec.collector === u.id) return "You collected this record, so someone else checks it. You cannot send back your own work.";
  if (status === "accepted") return `Only ${rule.who === "mel" ? "MEL" : deciderNames(people, rec, rule)} accepts field forms; you can send one back with a note.`;
  if (!note?.trim()) return "Write a note saying what to fix. It goes to the person who collected the form.";
  return null;
}
