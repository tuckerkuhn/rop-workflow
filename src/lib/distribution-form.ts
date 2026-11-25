import type { FieldSetup } from "@/lib/package";

/**
 * A project's KoboCollect distribution form, made from the input package it already saved in Field
 * activities. The package is entered once; the form, the stock check, the flags and the result all
 * follow from it. Before this, the form was written by hand with a script for each project, so a
 * project without a developer had no form, and a form could drift from its package.
 *
 * The questions are the ones the app reads (server/distribution, server/kobo): the same names as
 * the hand-built forms in kobo/. Nothing is asked that the phone or the app already knows: the
 * place is the phone's GPS when the form opens, the date defaults to today, each item is one tap
 * when the planned amount was handed over (an amount is typed only when it differed), and each
 * photo is tagged by the question it is taken on.
 *
 * English only until the app's other languages are ready. Pure: rows in, rows out. The file itself
 * is written by server/distribution-form.
 */

export type XlsForm = { survey: string[][]; choices: string[][]; settings: string[][] };

export const SURVEY_HEAD = ["type", "name", "label", "hint", "required", "relevant", "appearance", "calculation", "default", "parameters"];
export type Row = { type: string; name: string; label?: string; hint?: string; required?: boolean; relevant?: string; appearance?: string; calculation?: string; default?: string; parameters?: string; constraint?: string; constraint_message?: string };
/** A date the work cannot have happened on yet is refused on the phone. */
export const NOT_AFTER_TODAY = { constraint: ". <= today()", constraint_message: "This date is in the future. Check it." };
export const line = (r: Row) => [r.type, r.name, r.label ?? "", r.hint ?? "", r.required ? "yes" : "", r.relevant ?? "", r.appearance ?? "", r.calculation ?? "", r.default ?? "", r.parameters ?? ""];

/** A package item's key is already letters, digits and _ (lib/package); anything else cannot name a question. */
const usable = (key: string) => /^[a-z][a-z0-9_]{0,29}$/.test(key);

/** Why a form cannot be made from this package yet, in words; null when it can. */
export function formProblem(setup: FieldSetup | null | undefined): string | null {
  if (!setup?.items.length) return "Save the input package first: the form is made from it.";
  const bad = setup.items.filter((i) => !usable(i.key));
  if (bad.length) return `These items have a short name the form cannot use (${bad.map((i) => i.key).join(", ")}). Use lower-case letters, digits and _ only, starting with a letter.`;
  if (new Set(setup.items.map((i) => i.key)).size !== setup.items.length) return "Two items in the package have the same short name. Each needs its own.";
  return null;
}

/** The form for one project. `version` is a number KoboToolbox uses to tell a newer form from an older one. */
export function distributionForm(code: string, title: string, setup: FieldSetup, version: string): XlsForm {
  const rows: Row[] = [
    { type: "calculate", name: "project_code", calculation: `'${code.replace(/'/g, "")}'` },
    // Where it happened: the phone's own GPS when the form opens. Nothing to tap.
    { type: "start-geopoint", name: "start_geopoint" },
    { type: "select_one_from_file farmers.csv", name: "farmer", label: "Farmer receiving the inputs", hint: "Search by farmer ID or village", required: true, appearance: "autocomplete" },
    { type: "calculate", name: "farmer_ha", calculation: "pulldata('farmers', 'hectares', 'name', ${farmer})" },
    { type: "date", name: "distribution_date", label: "Distribution date", hint: "Today, unless you are entering a paper list from another day.", required: true, default: "today()", ...NOT_AFTER_TODAY },
  ];
  for (const it of setup.items) {
    const k = it.key;
    const qty = `pulldata('package', 'qty', 'name', '${k}')`;
    const per = `pulldata('package', 'per', 'name', '${k}')`;
    rows.push(
      // Planned for this farmer: the item's amount, times the farmer's hectares when it is per hectare.
      { type: "calculate", name: `${k}_plan`, calculation: `if(${per} = 'hectare', round(${qty} * number(\${farmer_ha}), 2), ${qty})` },
      { type: "calculate", name: `${k}_unit`, calculation: `pulldata('package', 'unit', 'name', '${k}')` },
      // One tap in the usual case: the planned amount was handed over. The amount is typed only when it differed.
      // The app reads an item answered "no" as not given, and an item with no amount as the planned amount.
      { type: "select_one given", name: `${k}_given`, label: `${it.item}: given to this farmer?`, hint: `Planned for this farmer: \${${k}_plan} \${${k}_unit}`, required: true },
      { type: "decimal", name: `${k}_qty`, label: `${it.item}: amount given (\${${k}_unit})`, hint: `Planned: \${${k}_plan} \${${k}_unit}. Enter what was handed over.`, required: true, relevant: `\${${k}_given} = 'other'` },
    );
  }
  rows.push(
    { type: "select_one condition", name: "condition", label: "Condition of the inputs at handover", required: true },
    { type: "select_one yes_no", name: "signed", label: "Did the recipient sign or thumbprint the goods received note, saying they received the goods in acceptable condition and are responsible for them from now on?", required: true },
    { type: "image", name: "list_photo", label: "Photo of the signed goods received note", hint: "The page with this farmer's signature or thumbprint. Fill the frame: the mark and the amounts must be readable.", required: true, parameters: "max-pixels=1024" },
    { type: "image", name: "handover_photo", label: "Photo of the handover (optional)", parameters: "max-pixels=1024" },
    // Asked only when the phone found no place by itself.
    { type: "geopoint", name: "location", label: "Location (GPS)", hint: "The phone did not find its place by itself. Record it here.", relevant: "string-length(${start_geopoint}) = 0" },
    { type: "text", name: "notes", label: "Anything else to note", hint: "The person who checks this record reads it. Use the farmer ID, never a name.", appearance: "multiline" },
  );
  const id = `${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_input_distribution`;
  return {
    survey: [[...SURVEY_HEAD, "constraint", "constraint_message"], ...rows.map((r) => [...line(r), r.constraint ?? "", r.constraint_message ?? ""])],
    choices: [
      ["list_name", "name", "label"],
      ["yes_no", "yes", "Yes"],
      ["yes_no", "no", "No"],
      ["given", "yes", "Yes, the planned amount"],
      ["given", "other", "Yes, a different amount"],
      ["given", "no", "No, not given"],
      ["condition", "good", "Good, undamaged"],
      ["condition", "some_damaged", "Some damaged"],
      ["condition", "damaged", "Mostly damaged or unusable"],
    ],
    settings: [
      ["form_title", "form_id", "version", "instance_name"],
      [title, id, version, "concat(${farmer}, ' ', ${distribution_date})"],
    ],
  };
}

/** What to do with the file, in order: shown beside the download so nobody needs a developer. */
export const FORM_STEPS = [
  "In KoboToolbox choose New, then Upload an XLSForm, pick this file and Deploy.",
  "In Setup here, connect KoboToolbox, choose the form and mark it Input distribution.",
  "Press Send farmer list to KoboToolbox. That also sends this package, so the form shows each farmer's planned amounts.",
  "Change the package later? Send the farmer list again. Add or remove an item? Download the form again and replace it in KoboToolbox.",
];
