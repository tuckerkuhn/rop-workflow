import ExcelJS from "exceljs";
import { CROP_PLAN_KEY, type CropPlan } from "@/lib/crops";
import { distributionForm, formProblem, type XlsForm } from "@/lib/distribution-form";
import { FIELD_FORM_NAME, fieldForm, type FieldFormKind } from "@/lib/field-forms";
import { projectByCode, setupOf } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { loadProjectStates } from "@/server/project-state";

/** An XLSForm as the file KoboToolbox takes: one sheet each for survey, choices and settings. */
async function xlsx(form: XlsForm): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of [["survey", form.survey], ["choices", form.choices], ["settings", form.settings]] as const) wb.addWorksheet(name).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// KoboToolbox takes a later number as a newer form: the minute it was made, so a second download the same day still replaces the first.
const versionNow = () => new Date().toISOString().replace(/\D/g, "").slice(0, 12);

/**
 * The project's KoboCollect distribution form as an XLSForm file (lib/distribution-form), made from
 * the input package saved in Field activities. Upload it in KoboToolbox as it is.
 */
export async function distributionFormFile(code: string): Promise<{ bytes: Buffer; filename: string; items: number }> {
  const project = await projectByCode(code);
  const setup = await setupOf(project);
  const problem = formProblem(setup);
  if (problem || !setup) throw new HttpError(409, problem ?? "Save the input package first: the form is made from it.");
  const name = project.code ?? code;
  const form = distributionForm(name, `${name} input distribution`, setup, versionNow());
  return { bytes: await xlsx(form), filename: `${name.toLowerCase()}-input-distribution-form.xlsx`, items: setup.items.length };
}

/**
 * The project's readiness check, training attendance or farm visit form as an XLSForm file
 * (lib/field-forms). None needs the input package. The farm visit form reads the crop plan saved in
 * Set up, to ask for the number planted or for the area.
 */
export async function fieldFormFile(code: string, kind: FieldFormKind): Promise<{ bytes: Buffer; filename: string }> {
  const project = await projectByCode(code);
  const name = project.code ?? code;
  const { [CROP_PLAN_KEY]: plan } = kind === "visit" ? await loadProjectStates<{ [CROP_PLAN_KEY]: CropPlan | null }>(project.id, { [CROP_PLAN_KEY]: null }) : { [CROP_PLAN_KEY]: null };
  return { bytes: await xlsx(fieldForm(kind, name, versionNow(), plan)), filename: `${name.toLowerCase()}-${FIELD_FORM_NAME[kind].file}-form.xlsx` };
}
