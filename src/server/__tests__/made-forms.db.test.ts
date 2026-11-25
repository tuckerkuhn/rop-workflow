import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { CROP_PLAN_KEY } from "@/lib/crops";
import { FIELD_FORM_KINDS, type FieldFormKind } from "@/lib/field-forms";
import { seedDatabase } from "@/server/demo-seed";
import { fieldFormFile } from "@/server/distribution-form";
import { toSubmission } from "@/server/kobo";
import { saveProjectState } from "@/server/project-state";
import { ready } from "@/server/__tests__/test-db";

/**
 * The app makes a project's readiness, training and farm visit forms as files KoboToolbox takes,
 * and reads back every answer its own forms ask for.
 */
const code = "A-2027";
const project = async () => (await db.select().from(s.projects).where(eq(s.projects.code, code)))[0];

async function sheets(kind: FieldFormKind) {
  const file = await fieldFormFile(code, kind);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.bytes as unknown as ArrayBuffer);
  const rows = (name: string) => {
    const out: string[][] = [];
    wb.getWorksheet(name)!.eachRow((r) => out.push((r.values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v)))));
    return out;
  };
  return { file, names: wb.worksheets.map((w) => w.name), survey: rows("survey"), settings: rows("settings") };
}
const questions = (survey: string[][]) => survey.slice(1).map((r) => r[1]);

/** A record as KoboToolbox would send it from the form, stored the way a sync stores it. */
async function stored(form: string, payload: Record<string, unknown>) {
  const p = await project();
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: p.organizationId, projectId: p.id, source: "kobo", form, farmerCode: typeof payload.farmer === "string" ? payload.farmer : null, reviewStatus: "pending", completedBy: "farida.kobo", completedAt: new Date("2026-11-25T08:00:00Z"), koboAssetUid: `a-${form}`, koboSubmissionUuid: `made-${form}-${payload._id}`, koboSubmissionId: Number(payload._id), payload })
    .returning();
  return toSubmission(row);
}

beforeAll(async () => {
  await ready;
  await seedDatabase();
});

describe("a project's field forms, made by the app", () => {
  it("each is an XLSForm file named for the project", async () => {
    for (const kind of FIELD_FORM_KINDS) {
      const f = await sheets(kind);
      expect(f.names).toEqual(["survey", "choices", "settings"]);
      expect(f.file.filename).toMatch(/^a-2027-(readiness-check|training-attendance|farm-visit)-form\.xlsx$/);
      expect(f.settings[1][0]).toMatch(/^A-2027 /);
      expect(questions(f.survey)).toContain("project_code");
    }
  });

  it("the farm visit form follows the crop plan saved in Set up", async () => {
    const p = await project();
    // The demo crop is sown by area.
    expect(questions((await sheets("visit")).survey)).toContain("area_planted");
    await saveProjectState(p.id, CROP_PLAN_KEY, { by: "count", unit: "vines", rowM: 3, plantM: 1.5 });
    const counted = questions((await sheets("visit")).survey);
    expect(counted).toContain("number_planted");
    expect(counted).not.toContain("area_planted");
    await saveProjectState(p.id, CROP_PLAN_KEY, { by: "area" });
  });

  it("the app reads back what its readiness form asks", async () => {
    const asked = questions((await sheets("readiness")).survey);
    const answers: Record<string, unknown> = { _id: 501, project_code: code, start_geopoint: "34.562 69.21 1790 6", farmer: "F-0004", visit_date: "2026-11-24", visit_type: "recheck", both_present: "yes", ready: "no", issue: "Ridges too close: redo at the trained spacing", photo: "plot.jpg", location: "34.5621 69.2103 1790 5" };
    // Every question on the form has an answer here, so nothing the form asks goes unread by this test.
    expect(Object.keys(answers)).toEqual(expect.arrayContaining(asked));
    const sub = await stored("readiness", answers);
    expect(sub).toMatchObject({ form: "readiness", farmerId: "F-0004", date: "2026-11-24", photo: true, gps: [34.5621, 69.2103] });
    expect(sub.fields).toEqual({ result: "No", visit_type: "Recheck", both_present: "Yes", issue: "Ridges too close: redo at the trained spacing" });
  });

  it("the app reads back what its training form asks", async () => {
    const asked = questions((await sheets("training")).survey);
    const answers: Record<string, unknown> = { _id: 502, project_code: code, start_geopoint: "34.562 69.21 1790 6", training_date: "2026-11-23", session: "crop_care", farmers: "F-0004 F-0005", register_ref: "Book 2 page 14", photo: "register.jpg", location: "", notes: "" };
    expect(Object.keys(answers)).toEqual(expect.arrayContaining(asked));
    const sub = await stored("training", answers);
    expect(sub).toMatchObject({ form: "training", farmers: ["F-0004", "F-0005"], date: "2026-11-23", photo: true });
    expect(sub.fields).toEqual({ session: "Crop care", attended: "F-0004, F-0005", register: "Book 2 page 14" });
  });

  it("the app reads back what its farm visit form asks, by area and by count", async () => {
    const p = await project();
    const common = { project_code: code, start_geopoint: "34.562 69.21 1790 6", farmer: "F-0004", farmer_ha: "0.5", visit_date: "2026-11-24", purpose: "planting_followup", both_present: "yes", planted: "yes", planting_date: "2026-11-20", spacing_ok: "no", issue: "Replant the two short rows by 1 December", photo: "plot.jpg", location: "34.5621 69.2103 1790 5" };
    const byArea = questions((await sheets("visit")).survey);
    expect(Object.keys({ ...common, area_planted: "0.4" })).toEqual(expect.arrayContaining(byArea));
    const area = await stored("visit", { _id: 503, ...common, area_planted: "0.4" });
    expect(area.fields).toEqual({ purpose: "Planting followup", both_present: "Yes", planted: "Yes", planting_date: "2026-11-20", spacing: "No", area: "0.4", issue: "Replant the two short rows by 1 December" });

    await saveProjectState(p.id, CROP_PLAN_KEY, { by: "count", unit: "vines", rowM: 3, plantM: 1.5 });
    const byCount = questions((await sheets("visit")).survey);
    expect(Object.keys({ ...common, number_planted: "880" })).toEqual(expect.arrayContaining(byCount));
    const count = await stored("visit", { _id: 504, ...common, spacing_ok: "yes", issue: undefined, number_planted: "880" });
    expect(count.fields).toEqual({ purpose: "Planting followup", both_present: "Yes", planted: "Yes", planting_date: "2026-11-20", spacing: "Yes", count: "880" });
    await saveProjectState(p.id, CROP_PLAN_KEY, { by: "area" });
  });
});
