import { densityOf, type CropPlan } from "@/lib/crops";
import { NOT_AFTER_TODAY, SURVEY_HEAD, line, type Row, type XlsForm } from "@/lib/distribution-form";

/**
 * A project's other three KoboCollect forms: the readiness check, training attendance and the farm
 * visit after planting. Made by the app for the project, like its distribution form
 * (lib/distribution-form). Before this they were files written by a script in kobo/, so a project
 * without a developer had no form to upload and nothing to mark in Setup.
 *
 * The questions carry the names the app reads (server/kobo toSubmission, server/review). Nothing is
 * asked that the phone or the app already knows: the place is the phone's GPS when the form opens,
 * dates default to today, and the farm visit asks for the number planted or for the area planted,
 * never both, by the crop plan the project saved in Set up.
 *
 * A mistake the app would refuse later is refused on the phone, while the person is still at the
 * plot: a date in the future, a planting date after the visit, an area above the farmer's plot.
 *
 * English only until the app's other languages are ready. Pure: rows in, rows out.
 */

export const FIELD_FORM_KINDS = ["readiness", "training", "visit"] as const;
export type FieldFormKind = (typeof FIELD_FORM_KINDS)[number];
export const isFieldFormKind = (v: string): v is FieldFormKind => (FIELD_FORM_KINDS as readonly string[]).includes(v);

/** What each form is called: in its title, its file name and on the button that downloads it. */
export const FIELD_FORM_NAME: Record<FieldFormKind, { title: string; id: string; file: string }> = {
  readiness: { title: "readiness check", id: "readiness_check", file: "readiness-check" },
  training: { title: "training attendance", id: "training_attendance", file: "training-attendance" },
  visit: { title: "farm visit", id: "field_visit", file: "farm-visit" },
};

type Checked = Row & { constraint?: string; constraint_message?: string };
const HEAD = [...SURVEY_HEAD, "constraint", "constraint_message"];
const row = (r: Checked) => [...line(r), r.constraint ?? "", r.constraint_message ?? ""];

const YES_NO = [
  ["yes_no", "yes", "Yes"],
  ["yes_no", "no", "No"],
];
const FARMER: Checked = { type: "select_one_from_file farmers.csv", name: "farmer", label: "Farmer", hint: "Search by farmer ID or village", required: true, appearance: "autocomplete" };
const PHOTO = "max-pixels=1024";
const BOTH_PRESENT: Checked = { type: "select_one yes_no", name: "both_present", label: "Are the extension agent and the MEL officer both at the plot?", required: true };
// Standing at the plot is the point: the plot's own place stays a question, beside the phone's fix.
const PLOT_GPS: Checked = { type: "geopoint", name: "location", label: "Plot location (GPS)", hint: "Stand on the plot and record it." };

const head = (code: string): Checked[] => [
  { type: "calculate", name: "project_code", calculation: `'${code.replace(/'/g, "")}'` },
  // Where it happened: the phone's own GPS when the form opens. Nothing to tap.
  { type: "start-geopoint", name: "start_geopoint" },
];

const form = (code: string, kind: FieldFormKind, version: string, rows: Checked[], choices: string[][], instance: string): XlsForm => ({
  survey: [HEAD, ...rows.map(row)],
  choices: [["list_name", "name", "label"], ...choices],
  settings: [
    ["form_title", "form_id", "version", "instance_name"],
    [`${code} ${FIELD_FORM_NAME[kind].title}`, `${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${FIELD_FORM_NAME[kind].id}`, version, instance],
  ],
});

/** The joint readiness visit: is the plot ready for the package, and if not, what must change. */
export function readinessForm(code: string, version: string): XlsForm {
  return form(
    code,
    "readiness",
    version,
    [
      ...head(code),
      FARMER,
      { type: "date", name: "visit_date", label: "Visit date", required: true, default: "today()", ...NOT_AFTER_TODAY },
      { type: "select_one visit_type", name: "visit_type", label: "Type of visit", required: true },
      BOTH_PRESENT,
      { type: "select_one yes_no", name: "ready", label: "Is the plot ready for the input package?", hint: "Prepared as trained: cleared, with the ridges and spacing shown at the training.", required: true },
      { type: "text", name: "issue", label: "What needs fixing?", hint: "Say exactly what the farmer must change before the recheck.", required: true, relevant: "${ready} = 'no'", appearance: "multiline" },
      // Required: a readiness record with no photo is flagged for the person who checks it, and the farmer's photo check stays open.
      { type: "image", name: "photo", label: "Photo of the plot", hint: "Show the prepared ground, or what needs fixing.", required: true, parameters: PHOTO },
      PLOT_GPS,
    ],
    [["visit_type", "first", "First visit"], ["visit_type", "recheck", "Recheck after correction"], ...YES_NO],
    "concat(${farmer}, ' ', ${visit_date})",
  );
}

/** One record per training session: the session and its register once, every farmer who attended ticked. */
export function trainingForm(code: string, version: string, o: { curriculum?: string; app?: boolean } = {}): XlsForm {
  return form(
    code,
    "training",
    version,
    [
      ...head(code),
      { type: "date", name: "training_date", label: "Training date", required: true, default: "today()", ...NOT_AFTER_TODAY },
      { type: "select_one session", name: "session", label: "Training session", required: true },
      // A farmer who is not ticked did not attend.
      { type: "select_multiple_from_file farmers.csv", name: "farmers", label: "Farmers who attended the classroom and field parts of the session", hint: "Tick every farmer who signed the register. Search by farmer ID or village.", required: true, appearance: "autocomplete" },
      // MF-09: what was taught, from Set up, and (in the app) each farmer's test scores.
      { type: "text", name: "curriculum", label: "Curriculum taught, and its version", hint: "As set for the project. Change it only if another one was used.", ...(o.curriculum ? { default: `'${o.curriculum.replace(/'/g, "")}'` } : {}) },
      ...(o.app
        ? [
            { type: "integer", name: "score_max", label: "The test is marked out of (optional)", hint: "Leave empty if no test was given.", constraint: ". >= 1 and . <= 1000", constraint_message: "Enter the top mark, between 1 and 1000." },
            { type: "scores", name: "scores", label: "Pre-test and post-test scores (optional)", hint: "For each farmer who took the test.", relevant: "string-length(${farmers}) > 0 and string-length(${score_max}) > 0" },
          ]
        : []),
      { type: "text", name: "register_ref", label: "Attendance register reference", hint: "Book and page of the signed register, and where the original is kept", required: true },
      { type: "image", name: "photo", label: "Photo of the signed register page", hint: "Fill the frame: every signature or thumbprint must be readable.", required: true, parameters: PHOTO },
      // Asked only when the phone found no place by itself.
      { type: "geopoint", name: "location", label: "Training location (GPS)", hint: "The phone did not find its place by itself. Record it here.", relevant: "string-length(${start_geopoint}) = 0" },
      { type: "text", name: "notes", label: "Anything else to note", hint: "The person who checks this record reads it. Use farmer IDs, never names.", appearance: "multiline" },
    ],
    [
      ["session", "land_prep", "Land preparation and planting"],
      ["session", "crop_care", "Crop care and irrigation"],
      ["session", "harvest", "Harvest and storage"],
    ],
    // A training record covers many farmers: it is named after its session and date.
    "concat(${session}, ' ', ${training_date})",
  );
}

/**
 * The farm visit after planting. A crop counted one by one with a spacing in the crop plan is asked
 * "how many were planted" and the app works out the hectares; any other crop is asked the area.
 */
export function visitForm(code: string, version: string, plan: CropPlan | null | undefined): XlsForm {
  const density = densityOf(plan);
  const unit = plan?.unit?.trim().toLowerCase() || "plants";
  const planted: Checked =
    density && plan
      ? {
          type: "integer",
          name: "number_planted",
          label: `How many ${unit} were planted?`,
          hint: `Count them. The app works out the area from the spacing: rows ${plan.rowM} m apart, ${plan.plantM} m between ${unit}.`,
          required: true,
          relevant: "${planted} = 'yes'",
          constraint: ". > 0",
          constraint_message: "Enter how many were planted, a whole number above zero.",
        }
      : {
          type: "decimal",
          name: "area_planted",
          label: "Area planted (hectares)",
          hint: "The farmer's plot is ${farmer_ha} ha.",
          required: true,
          relevant: "${planted} = 'yes'",
          // A farmer with no plot size on the list is not held up here: the app checks the area when the record is accepted.
          constraint: ". > 0 and (string-length(${farmer_ha}) = 0 or . <= number(${farmer_ha}))",
          constraint_message: "The area planted must be above zero and no more than the farmer's plot.",
        };
  return form(
    code,
    "visit",
    version,
    [
      ...head(code),
      FARMER,
      // The farmer's plot size from farmers.csv, shown with the area planted.
      { type: "calculate", name: "farmer_ha", calculation: "pulldata('farmers', 'hectares', 'name', ${farmer})" },
      { type: "date", name: "visit_date", label: "Visit date", required: true, default: "today()", ...NOT_AFTER_TODAY },
      { type: "select_one purpose", name: "purpose", label: "Purpose of the visit", required: true },
      BOTH_PRESENT,
      { type: "select_one yes_no", name: "planted", label: "Has the farmer planted the inputs received?", required: true },
      { type: "date", name: "planting_date", label: "Date planted", hint: "As the farmer reports it", required: true, relevant: "${planted} = 'yes'", constraint: ". <= ${visit_date}", constraint_message: "The date planted cannot be after the visit date." },
      planted,
      { type: "select_one yes_no", name: "spacing_ok", label: "Planted at the trained spacing and depth?", required: true, relevant: "${planted} = 'yes'" },
      { type: "text", name: "issue", label: "What needs follow-up?", hint: "Say what the farmer or the team must do, and by when.", required: true, relevant: "${planted} = 'no' or ${spacing_ok} = 'no'", appearance: "multiline" },
      { type: "image", name: "photo", label: "Photo of the plot", required: true, parameters: PHOTO },
      PLOT_GPS,
    ],
    [
      ["purpose", "planting_followup", "Planting follow-up"],
      ["purpose", "germination", "Germination check"],
      ["purpose", "crop_care", "Crop care check"],
      ["purpose", "harvest_planning", "Harvest planning"],
      ...YES_NO,
    ],
    "concat(${farmer}, ' ', ${visit_date})",
  );
}

export function fieldForm(kind: FieldFormKind, code: string, version: string, plan: CropPlan | null | undefined, o: { curriculum?: string; app?: boolean } = {}): XlsForm {
  return kind === "readiness" ? readinessForm(code, version) : kind === "training" ? trainingForm(code, version, o) : visitForm(code, version, plan);
}

/** What to do with a downloaded file, in order: shown beside the download so nobody needs a developer. */
export const FIELD_FORM_STEPS = [
  "In KoboToolbox choose New, then Upload an XLSForm, pick the file and Deploy.",
  "Come back to this page and press the button below. The form is then in the list above: tick it and check what it is for.",
  "On Check, Results and proof, press Send farmer list to KoboToolbox, so the form lists this project's farmers.",
];
