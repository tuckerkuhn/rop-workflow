import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canSeePII, type AppUser } from "@/lib/demo";
import { APP_FORM_KEY, RECORDED_BY_KEY } from "@/lib/form-record";
import { appForm, farmerOfAnswers, mayFillForms, mayRegister, formProblems, savedAnswers, type Answers, type AppForm, type AppFormKind, type FormLists } from "@/lib/app-forms";
import { today } from "@/lib/clock";
import { farmerListRows, projectByCode, setupFor } from "@/server/field-store";
import { importFarmers } from "@/server/farmers";
import { HttpError } from "@/server/guard";
import { logAudit } from "@/server/audit";
import { keepPhoto } from "@/server/file-store";
import { parseHousehold } from "@/lib/household";
import { splitNames } from "@/lib/eligibility";

export { mayFillForms, mayRegister };

/**
 * The field forms filled in inside the app (lib/app-forms): what the screen needs to show one, and
 * saving one. A saved form is the same record a KoboCollect submission was (lib/form-record), so the
 * review queue, Field activities and the distribution approval read it without change. Registering
 * a farmer adds them to the farmer list, as loading the list does (server/farmers).
 */

export async function formLists(code: string): Promise<FormLists> {
  const [farmers, setup] = await Promise.all([farmerListRows(code), setupFor(code)]);
  return { farmers, package: (setup?.items ?? []).map((i) => ({ name: i.key, label: i.item, qty: i.qty, unit: i.unit, per: i.per })) };
}

/** The form and the lists it looks things up in, for one person. */
export async function formFor(code: string, kind: AppFormKind, user: AppUser): Promise<{ form: AppForm; lists: FormLists }> {
  if (kind === "register" ? !mayRegister(user) : !mayFillForms(user)) throw new HttpError(403, kind === "register" ? "Only the project manager, plan approvers and extension agents register farmers." : "Only field staff who may change Field activities fill in field forms.");
  const setup = await setupFor(code);
  let form: AppForm;
  try {
    form = appForm(kind, code, { setup, plan: setup?.plan ?? null, names: canSeePII(user) });
  } catch (e) {
    throw new HttpError(409, e instanceof Error ? e.message : String(e));
  }
  return { form, lists: await formLists(code) };
}

/** A photo as the phone sends it: a JPEG, PNG or WebP, already made smaller on the phone. */
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/** About 1.5 MB of picture: a 1,024-pixel photo is far smaller. */
const PHOTO_MAX = 2_000_000;

export type FormEntry = {
  /** Made on the phone when the form was opened: saving the same form twice keeps one record. */
  entryId: string;
  answers: Answers;
  /** Each photo question's picture, by question name. */
  photos?: Record<string, string>;
  /** Register a farmer: the person checked the possible duplicates shown and says this is someone new. */
  duplicatesChecked?: boolean;
};

/**
 * Saves a filled-in form. The rules are checked again here; a form the phone let through with a
 * mistake is refused with the same words. Returns the record, or the farmer registered.
 */
export async function saveForm(code: string, kind: AppFormKind, entry: FormEntry, user: AppUser) {
  const { form, lists } = await formFor(code, kind, user);
  const day = today();
  const problems = formProblems(form, entry.answers, lists, day);
  if (problems.length) throw new HttpError(422, problems.map((p) => p.text).join(" "));
  const answers = savedAnswers(form, entry.answers, lists, day);

  // Each photo question answered has its picture, and nothing else is kept.
  const photos: Record<string, { src: string; sha256: string }> = {};
  for (const q of form.questions.filter((x) => x.kind === "image" && answers[x.name])) {
    const src = entry.photos?.[q.name];
    if (!src || !PHOTO.test(src)) throw new HttpError(422, `${q.label}: the photo did not arrive. Take it again.`);
    if (src.length > PHOTO_MAX) throw new HttpError(413, `${q.label}: the photo is too large. Take it again.`);
    // Kept inside the record, or in file storage with only its fingerprint here (server/file-store).
    photos[q.name] = await keepPhoto(code, src);
    // The answer is the photo's name, as KoboToolbox kept it: its fingerprint.
    answers[q.name] = `${photos[q.name].sha256.slice(0, 16)}.jpg`;
  }

  if (kind === "register") return { farmer: await register(code, answers, user, !!entry.duplicatesChecked) };

  const project = await projectByCode(code);
  const key = `app:${entry.entryId}`;
  const [already] = await db.select({ id: s.evidence.id }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.koboSubmissionUuid, key))).limit(1);
  if (already) return { id: already.id, again: true };
  const typed = farmerOfAnswers(kind, answers);
  // The farmer's ID as stored, whatever the case it was typed in (code review of R2-18).
  const [stored] = typed ? await db.select({ code: s.farmers.code }).from(s.farmers).where(and(eq(s.farmers.projectId, project.id), sql`upper(${s.farmers.code}) = ${typed.trim().toUpperCase()}`)).limit(1) : [];
  const farmer = stored?.code ?? typed;
  // The record and its audit line are saved together, or not at all.
  const row = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(s.evidence)
      .values({
        organizationId: project.organizationId,
        projectId: project.id,
        source: "manual",
        form: kind,
        farmerCode: farmer,
        reviewStatus: "pending",
        completedBy: user.id,
        completedAt: new Date(),
        // The same submission key column KoboToolbox records use: one record per form filled in.
        koboSubmissionUuid: key,
        payload: { ...answers, [APP_FORM_KEY]: kind, [RECORDED_BY_KEY]: { id: user.id, name: user.name }, ...(Object.keys(photos).length ? { _rop_photos: photos } : {}) },
      })
      .onConflictDoNothing()
      .returning({ id: s.evidence.id });
    if (!r) return null;
    const farmers = kind === "training" ? (answers.farmers ?? "").split(" ").filter(Boolean) : undefined;
    await logAudit(tx, project.id, { entity: "evidence", entityId: r.id, action: "form_filled", by: user.id, detail: { form: kind, farmer, ...(farmers ? { farmers } : {}), photos: Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, v.sha256])) } });
    return r;
  });
  if (!row) {
    const [r] = await db.select({ id: s.evidence.id }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.koboSubmissionUuid, key))).limit(1);
    return { id: r.id, again: true };
  }
  if (kind === "distribution") {
    // The same checks, flags and email to the project manager as a KoboCollect distribution.
    const { processPending } = await import("@/server/distribution");
    await processPending(code);
  }
  return { id: row.id, again: false };
}

async function register(code: string, a: Answers, user: AppUser, duplicatesChecked: boolean) {
  const project = await projectByCode(code);
  // R2-18: an ID is the same ID in capitals or not ("f-r2-01" is "F-R2-01"): kept in capitals, compared without case.
  const id = a.farmer_id!.trim().toUpperCase();
  const household = parseHousehold(a.household ?? "").members;
  const [known] = await db.select({ projectId: s.farmers.projectId }).from(s.farmers).where(sql`upper(${s.farmers.code}) = ${id}`).limit(1);
  if (known) throw new HttpError(409, known.projectId === project.id ? `${id} is already registered on this project. Open them in Field activities to change their details.` : `${id} is already used on another project. Farmer IDs must be unique: give this farmer a new ID.`);
  const r = await importFarmers(
    code,
    [
      {
        id,
        village: a.village!,
        gender: a.sex === "Male" ? "Male" : "Female",
        hectares: Number(a.hectares),
        ...(a.farmer_name && canSeePII(user) ? { name: a.farmer_name, ...(a.phone ? { phone: a.phone } : {}) } : {}),
        ...(a.age_band ? { ageBand: a.age_band as never } : {}),
        ...(a.household_size ? { householdSize: Number(a.household_size) } : {}),
        ...(household.length ? { household, householdSize: household.length } : {}),
        ...(a.package ? { package: a.package } : {}),
        ...(splitNames(a.crops ?? "").length ? { crops: splitNames(a.crops ?? "").slice(0, 20) } : {}),
        ...(a.contribution_paid ? { contributionPaid: a.contribution_paid === "yes" } : {}),
      },
    ],
    { id: user.id, name: user.name },
    { duplicatesChecked },
  );
  return { id, ...r };
}
