import ExcelJS from "exceljs";
import { distributionForm, formProblem } from "@/lib/distribution-form";
import { projectByCode, setupOf } from "@/server/field-store";
import { HttpError } from "@/server/guard";

/**
 * The project's KoboCollect distribution form as an XLSForm file (lib/distribution-form), made from
 * the input package saved in Field activities. Upload it in KoboToolbox as it is.
 */
export async function distributionFormFile(code: string): Promise<{ bytes: Buffer; filename: string; items: number }> {
  const project = await projectByCode(code);
  const setup = await setupOf(project);
  const problem = formProblem(setup);
  if (problem || !setup) throw new HttpError(409, problem ?? "Save the input package first: the form is made from it.");
  // KoboToolbox takes a later number as a newer form: the minute it was made, so a second download the same day still replaces the first.
  const version = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  const name = project.code ?? code;
  const form = distributionForm(name, `${name} input distribution`, setup, version);
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of [["survey", form.survey], ["choices", form.choices], ["settings", form.settings]] as const) wb.addWorksheet(name).addRows(rows);
  return { bytes: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${name.toLowerCase()}-input-distribution-form.xlsx`, items: setup.items.length };
}
