import {
  conflictOf,
  toYou,
  nextSigners,
  pick,
  rolesOf,
  seesAll,
  visibleFields,
  warningsFor,
  type Entry,
  type Fields,
  type HrRole,
  type HrState,
  type Integrity,
  type Proposal,
} from "@/lib/hr";
import type { AppUser } from "@/lib/demo";

/**
 * What one person may see of the HR record. Pay and contact details only reach the person
 * themselves and holders of an HR role; supervisors see their team's job details only.
 */

export type PersonView = {
  id: string;
  name: string;
  title: string;
  office: string;
  fields: Fields;
  /** Which groups this viewer may see. */
  groups: ("job" | "pay" | "details")[];
  upcoming: { effective: string; proposal: number; fields: Fields }[];
  separated: { effective: string; reason: string } | null;
};

export type ProposalView = Omit<Proposal, "fields" | "before"> & {
  fields?: Fields;
  before?: Fields;
  warnings: string[];
  next: { role: HrRole; fellBack: boolean; people: string[]; blocked: { id: string; why: string }[] } | null;
  canSign: boolean;
  /** Why this viewer cannot sign, when they hold the role but are conflicted. */
  cannotSign: string | null;
  canWithdraw: boolean;
};

export type HrView = {
  me: string;
  roles: HrRole[];
  seesAll: boolean;
  sample: boolean;
  book: string;
  integrity: Integrity;
  names: Record<string, string>;
  rules: HrState["rules"];
  people: PersonView[];
  proposals: ProposalView[];
  relations: HrState["relations"];
  ignored: HrState["ignored"];
  entries: Pick<Entry, "n" | "at" | "actor" | "kind" | "subject" | "hash">[];
  seals: HrState["seals"];
  /** Everyone in the app, for choosing a supervisor or a related person. */
  directory: { id: string; name: string }[];
};

export function viewFor(me: string, state: HrState, entries: Entry[], integrity: Integrity, appPeople: AppUser[], book: string, sample: boolean): HrView {
  const all = seesAll(me, state);
  const names: Record<string, string> = {};
  for (const u of appPeople) names[u.id] = u.name;
  for (const p of Object.values(state.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  for (const p of state.proposals) if (p.type === "hire" && typeof p.fields.name === "string" && !names[p.subject]) names[p.subject] = p.fields.name;

  const people: PersonView[] = Object.values(state.people)
    .map((p) => {
      const groups = visibleFields(me, p.id, state);
      if (!groups.length) return null;
      return {
        id: p.id,
        name: names[p.id] ?? p.id,
        title: String(p.current.title ?? ""),
        office: String(p.current.office ?? ""),
        fields: pick(p.current, groups),
        groups,
        upcoming: p.upcoming.map((u) => ({ ...u, fields: pick(u.fields, groups) })).filter((u) => Object.keys(u.fields).length),
        separated: p.separated,
      };
    })
    .filter((p): p is PersonView => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));

  const proposals: ProposalView[] = state.proposals
    .filter((p) => all || p.subject === me || p.by === me)
    .map((p) => {
      const next = nextSigners(p, state);
      const groups = p.subject ? visibleFields(me, p.subject, state) : ["job", "pay", "details"];
      const holds = !!next && (state.rules?.holders[next.fellBack ? "board" : next.role] ?? []).includes(me);
      const base: ProposalView = {
        ...p,
        warnings: all && p.status === "pending" ? warningsFor(p, state) : [],
        next,
        canSign: !!next?.people.includes(me),
        cannotSign: holds && !next?.people.includes(me) ? toYou(conflictOf(me, p, state) ?? "") || null : null,
        canWithdraw: p.status === "pending" && p.by === me,
      };
      if (p.type === "hire" || p.type === "update") {
        base.fields = pick(p.fields, groups as PersonView["groups"]);
        base.before = pick(p.before, groups as PersonView["groups"]);
      }
      return base;
    })
    .sort((a, b) => b.id - a.id);

  return {
    me,
    roles: rolesOf(me, state),
    seesAll: all,
    sample,
    book,
    integrity,
    names,
    rules: all ? state.rules : null,
    people,
    proposals,
    relations: all ? state.relations : state.relations.filter((r) => r.a === me || r.b === me),
    ignored: all ? state.ignored : [],
    entries: all ? entries.slice(-300).reverse().map(({ n, at, actor, kind, subject, hash }) => ({ n, at, actor, kind, subject, hash })) : [],
    seals: state.seals.slice(-30).reverse(),
    directory: Object.entries(names)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** For Home: how many changes are waiting for this person's signature. */
export const waitingFor = (me: string, state: HrState) => state.proposals.filter((p) => nextSigners(p, state)?.people.includes(me)).length;
