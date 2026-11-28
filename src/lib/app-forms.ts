import { FIELD_FORM_NAME, fieldForm, type FieldFormKind } from "@/lib/field-forms";
import { distributionForm, type XlsForm } from "@/lib/distribution-form";
import { asText, evaluate, truthy, type ExprContext } from "@/lib/form-expr";
import { AGE_BANDS } from "@/lib/field";
import { FARMER_ID } from "@/lib/farmer-import";
import type { CropPlan } from "@/lib/crops";
import type { FieldSetup } from "@/lib/package";
import { canEditProject, type AppUser } from "@/lib/demo";

/**
 * The field forms filled in inside the app: distribution, readiness, training attendance, farm visit
 * and register a farmer. One reader for all five: each form is the same list of questions the app
 * already made for KoboCollect (lib/distribution-form, lib/field-forms), read here into questions a
 * screen can show. The same rules run on the phone while it is filled in and on the server when it
 * is saved (lib/form-expr), so an answer the phone refused is refused again if it gets through.
 *
 * Answers are text, the way KoboToolbox sent them: a choice is its name ("yes"), several choices are
 * names separated by spaces, a number is its digits, a date is YYYY-MM-DD and a photo is the name of
 * its file. They are saved with the same names, so everything that read a KoboCollect record reads
 * these (server/kobo toSubmission, server/review, server/distribution).
 *
 * Pure: a form and answers in, what to show and what is wrong out.
 */

export const APP_FORM_KINDS = ["distribution", "readiness", "training", "visit", "register"] as const;
export type AppFormKind = (typeof APP_FORM_KINDS)[number];
export const isAppFormKind = (v: string): v is AppFormKind => (APP_FORM_KINDS as readonly string[]).includes(v);

/** What each form is called on screen, and what it is for. */
export const APP_FORM_TEXT: Record<AppFormKind, { title: string; what: string }> = {
  distribution: { title: "Input distribution", what: "A farmer received the input package. One record per farmer." },
  readiness: { title: "Readiness check", what: "Is the farmer's plot ready for the package? One record per plot visit." },
  training: { title: "Training attendance", what: "One record per session, with every farmer who attended ticked." },
  visit: { title: "Farm visit", what: "After planting: what was planted, and anything to follow up." },
  register: { title: "Register a farmer", what: "Add a farmer to this project, with their village, sex and plot." },
};

/** Who may fill in the project's field forms: field staff who may change Field activities. */
export const mayFillForms = (u: AppUser) => u.kind === "employee" && u.fieldAccess === "edit";

/** Whether this person may open any field form: one to fill in, or registering a farmer. */
export const mayOpenForms = (u: AppUser) => mayFillForms(u) || mayRegister(u);

/**
 * Who may register a farmer: the project manager and plan approvers (who may load the farmer list),
 * and the extension agents who sign farmers up in the field. A default, not a rule written for ROP:
 * the narrowest group that does the work, and the easiest to widen.
 */
export const mayRegister = (u: AppUser) => u.kind === "employee" && (canEditProject(u) || (u.fieldAccess === "edit" && (u.field.includes("manager") || u.field.includes("extension"))));

export type QuestionKind = "calculate" | "here" | "farmer" | "farmers" | "date" | "one" | "decimal" | "integer" | "text" | "image" | "place";

export type Question = {
  kind: QuestionKind;
  name: string;
  label: string;
  hint?: string;
  required: boolean;
  relevant?: string;
  calculation?: string;
  default?: string;
  constraint?: string;
  constraintMessage?: string;
  /** The choice list of a "one" question. */
  list?: string;
  multiline?: boolean;
};

export type Choice = { name: string; label: string };
export type AppForm = { kind: AppFormKind; title: string; questions: Question[]; choices: Record<string, Choice[]> };

/** The farmer list and package a form looks things up in (pulldata), as KoboCollect had them in farmers.csv and package.csv. */
export type FormLists = {
  farmers: { name: string; label: string; hectares: number | null }[];
  package: { name: string; label: string; qty: number; unit: string; per: string }[];
};

const KIND_OF: Record<string, QuestionKind> = {
  calculate: "calculate",
  "start-geopoint": "here",
  date: "date",
  decimal: "decimal",
  integer: "integer",
  text: "text",
  image: "image",
  geopoint: "place",
};

/** Reads a made form's rows into questions. A question type the app cannot show is refused, never skipped. */
export function readForm(kind: AppFormKind, x: XlsForm): AppForm {
  const [head, ...rows] = x.survey;
  const col = (r: string[], c: string) => {
    const i = head.indexOf(c);
    return i < 0 ? "" : (r[i] ?? "");
  };
  const questions = rows.map((r): Question => {
    const type = col(r, "type");
    const q = (k: QuestionKind, list?: string): Question => ({
      kind: k,
      name: col(r, "name"),
      label: col(r, "label"),
      ...(col(r, "hint") ? { hint: col(r, "hint") } : {}),
      required: col(r, "required") === "yes",
      ...(col(r, "relevant") ? { relevant: col(r, "relevant") } : {}),
      ...(col(r, "calculation") ? { calculation: col(r, "calculation") } : {}),
      ...(col(r, "default") ? { default: col(r, "default") } : {}),
      ...(col(r, "constraint") ? { constraint: col(r, "constraint") } : {}),
      ...(col(r, "constraint_message") ? { constraintMessage: col(r, "constraint_message") } : {}),
      ...(list ? { list } : {}),
      ...(col(r, "appearance") === "multiline" ? { multiline: true } : {}),
    });
    if (type === "select_one_from_file farmers.csv") return q("farmer");
    if (type === "select_multiple_from_file farmers.csv") return q("farmers");
    if (type.startsWith("select_one ")) return q("one", type.slice("select_one ".length));
    const k = KIND_OF[type];
    if (!k) throw new Error(`The ${kind} form has a question of type "${type}", which the app cannot show.`);
    return q(k);
  });
  const choices: Record<string, Choice[]> = {};
  for (const [list, name, label] of x.choices.slice(1)) (choices[list] ??= []).push({ name, label });
  return { kind, title: APP_FORM_TEXT[kind].title, questions, choices };
}

/**
 * Register a farmer: what the farmer list template asks (lib/farmer-import), one farmer at a time.
 * The name is asked only of someone who may see names (`names`); everyone else records the farmer
 * by ID only, as the list import does.
 */
export function registerForm(names: boolean): XlsForm {
  const rows: string[][] = [
    ["type", "name", "label", "hint", "required", "relevant", "appearance", "calculation", "default", "parameters", "constraint", "constraint_message"],
    ["start-geopoint", "start_geopoint", "", "", "", "", "", "", "", "", "", ""],
    ["text", "farmer_id", "Farmer ID", "As written on the farmer's card. Letters, digits, . _ and - only.", "yes", "", "", "", "", "", "", ""],
    ...(names ? [["text", "farmer_name", "Farmer's name (optional)", "Kept in the app only. It never goes to donors, reports or the AI.", "", "", "", "", "", "", "", ""]] : []),
    ["text", "village", "Village", "", "yes", "", "", "", "", "", "", ""],
    ["select_one sex", "sex", "Sex", "", "yes", "", "", "", "", "", "", ""],
    ["select_one age_band", "age_band", "Age", "", "", "", "", "", "", "", "", ""],
    ["decimal", "hectares", "Plot size (hectares)", "The land the farmer will plant on this project.", "yes", "", "", "", "", "", ". >= 0 and . <= 100", "Enter the plot size in hectares, between 0 and 100."],
    ["integer", "household_size", "People in the household", "", "", "", "", "", "", "", ". >= 1 and . <= 100", "Enter the number of people, between 1 and 100."],
    ["select_one yes_no", "contribution_paid", "Has the farmer paid their contribution?", "", "", "", "", "", "", "", "", ""],
  ];
  return {
    survey: rows,
    choices: [
      ["list_name", "name", "label"],
      ["sex", "Female", "Female"],
      ["sex", "Male", "Male"],
      ...AGE_BANDS.map((b) => ["age_band", b, b]),
      ["yes_no", "yes", "Yes"],
      ["yes_no", "no", "No"],
    ],
    settings: [["form_title", "form_id", "version", "instance_name"], ["Register a farmer", "register_farmer", "1", ""]],
  };
}

/** The form of this kind for a project, from what it saved in Set up (the package, the crop plan). */
export function appForm(kind: AppFormKind, code: string, o: { setup?: FieldSetup | null; plan?: CropPlan | null; names?: boolean }): AppForm {
  if (kind === "register") return readForm(kind, registerForm(!!o.names));
  if (kind === "distribution") {
    if (!o.setup?.items.length) throw new Error("Save the input package first: the distribution form is made from it.");
    return readForm(kind, distributionForm(code, `${code} input distribution`, o.setup, "app"));
  }
  return readForm(kind, fieldForm(kind as FieldFormKind, code, "app", o.plan ?? null));
}

export type Answers = Record<string, string>;

/** Where the form is: every question's value (answered, defaulted or worked out) and which are shown. */
export function formState(form: AppForm, answers: Answers, lists: FormLists, today: string) {
  const values: Record<string, string> = {};
  const shown = new Set<string>();
  const lookup = (file: string, column: string, key: string) => {
    if (file === "farmers") {
      const f = lists.farmers.find((x) => x.name === key);
      return f ? asText((f as Record<string, unknown>)[column] as string | number) : "";
    }
    if (file === "package") {
      const i = lists.package.find((x) => x.name === key);
      return i ? asText((i as Record<string, unknown>)[column] as string | number) : "";
    }
    return "";
  };
  const ctx = (self?: string): ExprContext => ({ value: (n) => values[n] ?? "", self, today, lookup });
  for (const q of form.questions) {
    // A question is shown when its rule says so, worked out from the answers above it.
    const on = !q.relevant || truthy(evaluate(q.relevant, ctx()));
    if (q.kind === "calculate") {
      values[q.name] = on && q.calculation ? asText(evaluate(q.calculation, ctx())) : "";
      continue;
    }
    if (!on) {
      values[q.name] = "";
      continue;
    }
    shown.add(q.name);
    const given = answers[q.name];
    values[q.name] = given !== undefined ? given : q.default ? asText(evaluate(q.default, ctx())) : "";
  }
  return { values, shown, ctx };
}

export type Problem = { name: string; text: string };

const NUMBER = /^-?\d+(\.\d+)?$/;

/** "Village: this is needed." but "What needs fixing? This is needed.": a question keeps its own mark. */
const about = (label: string, text: string) => (/[?]$/.test(label) ? `${label} ${text.charAt(0).toUpperCase()}${text.slice(1)}` : `${label}: ${text}`);

/** What is missing or refused, question by question, in the form's order. Empty when it may be saved. */
export function formProblems(form: AppForm, answers: Answers, lists: FormLists, today: string): Problem[] {
  const { values, shown, ctx } = formState(form, answers, lists, today);
  const out: Problem[] = [];
  for (const q of form.questions) {
    if (!shown.has(q.name)) continue;
    const v = (values[q.name] ?? "").trim();
    const label = q.label || q.name;
    if (!v) {
      if (q.required) out.push({ name: q.name, text: about(label, `this is needed.`) });
      continue;
    }
    if (form.kind === "register" && q.name === "farmer_id" && !FARMER_ID.test(v)) out.push({ name: q.name, text: about(label, `use letters, digits, . _ and - only, up to 40.`) });
    else if (q.kind === "decimal" && !NUMBER.test(v)) out.push({ name: q.name, text: about(label, `enter a number.`) });
    else if (q.kind === "integer" && !/^-?\d+$/.test(v)) out.push({ name: q.name, text: about(label, `enter a whole number.`) });
    else if (q.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) out.push({ name: q.name, text: about(label, `enter a date.`) });
    else if (q.kind === "one" && !(form.choices[q.list!] ?? []).some((c) => c.name === v)) out.push({ name: q.name, text: about(label, `choose one of the answers.`) });
    else if (q.kind === "farmer" && !lists.farmers.some((f) => f.name === v)) out.push({ name: q.name, text: about(label, `${v} is not on this project's farmer list.`) });
    else if (q.kind === "farmers") {
      const unknown = v.split(" ").filter((id) => id && !lists.farmers.some((f) => f.name === id));
      if (unknown.length) out.push({ name: q.name, text: about(label, `not on this project's farmer list: ${unknown.join(", ")}.`) });
    } else if (q.constraint && !truthy(evaluate(q.constraint, ctx(v)))) out.push({ name: q.name, text: q.constraintMessage ?? about(label, `check this answer.`) });
  }
  return out;
}

/**
 * The answers as they are saved: only the questions shown, with defaults filled in and worked-out
 * values kept (the planned amount for this farmer, the plot size), so the record says what the
 * person saw.
 */
export function savedAnswers(form: AppForm, answers: Answers, lists: FormLists, today: string): Answers {
  const { values, shown } = formState(form, answers, lists, today);
  const out: Answers = {};
  for (const q of form.questions) {
    const v = values[q.name] ?? "";
    if ((q.kind === "calculate" || shown.has(q.name)) && v !== "") out[q.name] = v.trim();
  }
  return out;
}

/** The farmer a record is about, or null for a session record that ticks many. */
export const farmerOfAnswers = (kind: AppFormKind, a: Answers) => (kind === "register" ? (a.farmer_id ?? null) : kind === "training" ? null : (a.farmer ?? null));

export { FIELD_FORM_NAME };

/** A label or hint with its worked-out values put in: "Planned for this farmer: ${seed_plan} ${seed_unit}" → "… 25 kg". */
export const fillText = (text: string, values: Record<string, string>) => text.replace(/\$\{([a-z][a-z0-9_]*)\}/g, (_, n: string) => values[n] || "…");
