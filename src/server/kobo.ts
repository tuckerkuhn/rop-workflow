import { formLabel } from "@/lib/project";
import { koboPlace } from "@/lib/kobo-photo";
import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Submission, SubmissionForm } from "@/lib/project";
import { farmerListRows, projectByCode, setupFor } from "@/server/field-store";
import { readinessForms } from "@/server/kobo-link";
import { heldFarmers, sessionFarmers } from "@/lib/kobo-setup";

/**
 * Readiness checks from KoboToolbox: the farmer list pushed to the project's readiness form as
 * media, and stored rows mapped into review-queue entries. Submissions come in through the
 * project's own Kobo link (server/kobo-link.ts), by sync or automatic sync.
 */

export async function farmersCsv(code: string) {
  const rows = await farmerListRows(code);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // hectares: a distribution form works out each farmer's per-hectare amounts from it (pulldata).
  return ["name,label,hectares", ...rows.map((r) => `${esc(r.name)},${esc(r.label)},${r.hectares ?? ""}`)].join("\n") + "\n";
}

/**
 * package.csv for distribution forms: each package item's amount, unit and whether it is per farmer
 * or per hectare, from the package saved in Field activities. Null when the project has none.
 */
export async function packageCsv(code: string) {
  const setup = await setupFor(code);
  if (!setup) return null;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["name,label,qty,unit,per", ...setup.items.map((i) => [i.key, i.item, String(i.qty), i.unit, i.per].map(esc).join(","))].join("\n") + "\n";
}

/**
 * Replaces farmers.csv on the project's readiness form(s) and redeploys so devices and the web
 * form get it. Uses the project's own Kobo link and Kobo's asset files API (form_media).
 */
export async function pushFarmerList(code: string) {
  const k = await readinessForms(code);
  const headers = { Authorization: `Token ${k.token}`, Accept: "application/json" };
  const csv = await farmersCsv(code);
  const pkg = await packageCsv(code);
  let redeployed = true;
  for (const form of k.forms) {
    const files: [string, string][] = [["farmers.csv", csv], ...(form.purpose === "distribution" && pkg ? ([["package.csv", pkg]] as [string, string][]) : [])];
    const asset = `${k.server}/api/v2/assets/${encodeURIComponent(form.assetUid)}`;
    const filesUrl = `${asset}/files/`;

    const existing = await fetch(`${filesUrl}?file_type=form_media`, { headers, cache: "no-store" });
    if (!existing.ok) throw new Error(`Kobo returned ${existing.status} listing form media on ${form.name}.`);
    const list = (await existing.json()) as { results: { uid: string; metadata?: { filename?: string } }[] };
    for (const [filename, body] of files) {
      for (const f of list.results.filter((x) => x.metadata?.filename === filename)) {
        await fetch(`${filesUrl}${f.uid}/`, { method: "DELETE", headers });
      }
      // Kobo accepts media as base64 JSON; its multipart upload returned a server error in testing.
      const upload = await fetch(filesUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "default",
          file_type: "form_media",
          metadata: { filename },
          base64Encoded: `data:text/csv;base64,${Buffer.from(body).toString("base64")}`,
        }),
      });
      if (!upload.ok) throw new Error(`Kobo rejected ${filename} on ${form.name} (${upload.status}): ${(await upload.text()).slice(0, 200)}`);
    }

    // Redeploy so the new media reaches the web form and phones.
    const current = await fetch(`${asset}/`, { headers, cache: "no-store" });
    const { version_id } = (await current.json()) as { version_id?: string };
    const redeploy = await fetch(`${asset}/deployment/`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ active: true, version_id }),
    });
    redeployed &&= redeploy.ok;
  }
  return { farmers: csv.trim().split("\n").length - 1, forms: k.forms.length, redeployed };
}

/* ---------- stored rows → review queue entries ---------- */

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** A choice name as words: "land_prep" → "Land prep". */
const label = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : "");

/**
 * Where the form was filled in: the phone's own fix when the form was opened, else the GPS question,
 * else KoboToolbox's own reading (lib/kobo-photo koboPlace). Nobody types coordinates.
 */
function gpsOf(p: Record<string, unknown>): [number, number] | null {
  const at = koboPlace(p);
  return at ? [at.lat, at.lon] : null;
}

type EvidenceRow = typeof s.evidence.$inferSelect;


export function toSubmission(row: EvidenceRow): Submission {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const status = row.reviewStatus;
  const decided = { decidedBy: row.reviewedBy ?? undefined, decidedOn: row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : undefined, note: row.queryNote ?? undefined };
  if (row.source !== "kobo") {
    // Seeded demo record, or one recorded in the app: the payload is already a review-queue entry.
    return { ...(p as unknown as Submission), dbId: row.id, source: (p as { source?: string }).source === "app" ? "app" : "sample", status, ...decided };
  }
  const ready = str(p.ready);
  const fields: Record<string, string> = {
    result: ready === "yes" ? "Yes" : ready === "no" ? "No" : "",
    visit_type: str(p.visit_type) === "recheck" ? "Recheck" : str(p.visit_type) ? "First visit" : "",
    both_present: str(p.both_present) === "yes" ? "Yes" : str(p.both_present) === "no" ? "No" : "",
  };
  if (ready === "no") fields.issue = str(p.issue);
  if (row.form === "distribution") {
    // The Kobo distribution form (kobo/build_distribution_form.py). Sex comes from the farmer record.
    for (const k of Object.keys(fields)) delete fields[k];
    // Amounts are "<item>_qty" (or "seed_kg"/"npk_kg" on the demo form); an item answered "not given" is left out.
    const amounts = Object.fromEntries(
      Object.entries(p).filter(([k, v]) => /^[a-z][a-z0-9_]*_(qty|kg)$/.test(k) && typeof v === "string" && p[`${k.replace(/_(qty|kg)$/, "")}_given`] !== "no").map(([k, v]) => [k, v as string]),
    );
    Object.assign(fields, { gender: str(p._rop_gender), ...amounts, signature: str(p.signed) === "yes" ? "Yes" : "Not confirmed" });
  }
  const yn = (v: unknown) => (str(v) === "yes" ? "Yes" : str(v) === "no" ? "No" : "");
  const ticked = row.form === "training" ? sessionFarmers(p) : null;
  if (row.form === "training") {
    // kobo/build_field_forms.py, training attendance. Sex comes from the farmer record when accepted.
    for (const k of Object.keys(fields)) delete fields[k];
    // One record per session with its farmers ticked, or (the earlier form) one record per farmer.
    if (ticked) Object.assign(fields, { session: label(str(p.session)), attended: ticked.join(", "), register: str(p.register_ref) });
    else Object.assign(fields, { session: label(str(p.session)), attended: yn(p.attended), register: str(p.register_ref) });
  }
  if (row.form === "visit") {
    // kobo/build_field_forms.py, farm visit after planting.
    for (const k of Object.keys(fields)) delete fields[k];
    Object.assign(fields, { purpose: label(str(p.purpose)), both_present: yn(p.both_present), planted: yn(p.planted) });
    if (str(p.planted) === "yes") {
      Object.assign(fields, { planting_date: str(p.planting_date), spacing: yn(p.spacing_ok) });
      // The planting record: the number planted for a crop counted one by one, else the area in hectares.
      const num = (v: unknown) => (typeof v === "number" ? String(v) : str(v).trim());
      if (num(p.number_planted)) fields.count = num(p.number_planted);
      if (num(p.area_planted)) fields.area = num(p.area_planted);
    }
    if (str(p.planted) === "no" || str(p.spacing_ok) === "no") fields.issue = str(p.issue);
  }
  return {
    id: `KB-${p._id ?? row.koboSubmissionUuid?.slice(0, 8)}`,
    dbId: row.id,
    source: "kobo",
    orgId: row.organizationId ?? "",
    form: (row.form as SubmissionForm) ?? "readiness",
    farmerId: ticked ? "" : (row.farmerCode ?? str(p.farmer)),
    ...(ticked ? { farmers: ticked } : {}),
    ...(ticked && heldFarmers(p).length ? { held: heldFarmers(p).map((id) => ({ id })) } : {}),
    date: str(p.visit_date) || str(p.training_date) || (row.completedAt ? row.completedAt.toISOString().slice(0, 10) : ""),
    enumerator: row.completedBy ?? "kobo",
    gps: gpsOf(p),
    fields,
    photo: !!str(p.photo) || !!str(p.list_photo),
    status,
    ...decided,
  };
}

/** Whether a stored record is a field form the review queue shows (training, readiness, distribution, visit). */
export const isQueueForm = (form: string | null): form is SubmissionForm => !!form && form in formLabel;

export async function listSubmissions(code: string) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.evidence).where(eq(s.evidence.projectId, project.id)).orderBy(desc(s.evidence.createdAt));
  // A pending check deleted in KoboToolbox leaves the queue; decided ones stay as history.
  // Only field forms belong in the queue. Recorded results and weekly updates are stored beside
  // them with another shape (no form answers), and listing them here broke the queue's screen.
  return { project, submissions: rows.filter((r) => isQueueForm(r.form) && !(r.koboRemovedAt && r.reviewStatus === "pending")).map(toSubmission) };
}
