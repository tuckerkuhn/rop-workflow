import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { READINESS_FORM_ID, type Submission, type SubmissionForm } from "@/lib/project";
import { farmerListRows, projectByCode } from "@/server/field-store";

/**
 * KoboToolbox link: intake shared by the webhook and the manual sync, the farmer list
 * pushed to the form as media, and mapping stored rows into review-queue entries.
 */

export type KoboPayload = Record<string, unknown> & { _uuid?: string; project_code?: string };

/**
 * Which ROP form a submission came from. Kobo's data API labels submissions with the form's
 * asset UID (e.g. "ajiFYGjF8i3ieHAAsqztgm"), not the XLSForm form_id, so accept either.
 */
function formOf(xformId: string): string {
  if (xformId === READINESS_FORM_ID || (xformId && xformId === process.env.KOBO_READINESS_ASSET_UID)) return "readiness";
  return xformId;
}

function koboConfig() {
  const server = process.env.KOBO_SERVER_URL?.replace(/\/$/, "");
  const token = process.env.KOBO_API_TOKEN;
  const asset = process.env.KOBO_READINESS_ASSET_UID;
  if (!server || !token) throw new Error("KOBO_SERVER_URL and KOBO_API_TOKEN must be set in .env.local.");
  if (!asset) throw new Error("KOBO_READINESS_ASSET_UID is not set. Deploy the readiness form in Kobo and copy its asset UID into .env.local.");
  return { server, token, asset, headers: { Authorization: `Token ${token}`, Accept: "application/json" } };
}

/**
 * Stores one submission once. Duplicates (same Kobo _uuid) are skipped by the unique index.
 * Returns "new", "duplicate" or a reason it was skipped.
 */
export async function ingest(payload: KoboPayload): Promise<"new" | "duplicate" | string> {
  const uuid = typeof payload._uuid === "string" ? payload._uuid : undefined;
  if (!uuid) return "skipped: no _uuid";
  const code = typeof payload.project_code === "string" ? payload.project_code : undefined;
  if (!code) return "skipped: no project_code";
  const project = await projectByCode(code);
  const formId = typeof payload._xform_id_string === "string" ? payload._xform_id_string : "";
  const inserted = await db
    .insert(s.evidence)
    .values({
      organizationId: project.organizationId,
      projectId: project.id,
      source: "kobo",
      form: formOf(formId),
      farmerCode: typeof payload.farmer === "string" ? payload.farmer : null,
      koboAssetUid: formId || null,
      koboSubmissionUuid: uuid,
      completedBy: typeof payload._submitted_by === "string" ? payload._submitted_by : null,
      completedAt: typeof payload._submission_time === "string" ? new Date(payload._submission_time) : null,
      location: typeof payload.location === "string" ? payload.location : null,
      payload,
      reviewStatus: "pending",
    })
    .onConflictDoNothing({ target: s.evidence.koboSubmissionUuid })
    .returning({ id: s.evidence.id });
  return inserted.length ? "new" : "duplicate";
}

/** Manual pull of every submission on the readiness form. Safe to run repeatedly. */
export async function syncFromKobo() {
  const k = koboConfig();
  let url: string | null = `${k.server}/api/v2/assets/${k.asset}/data/?format=json&limit=500`;
  const counts = { fetched: 0, new: 0, duplicate: 0, skipped: 0, reasons: [] as string[] };
  while (url) {
    const res = await fetch(url, { headers: k.headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Kobo returned ${res.status} for the submissions request. Check the asset UID and token.`);
    const page = (await res.json()) as { results: KoboPayload[]; next: string | null };
    for (const sub of page.results) {
      counts.fetched += 1;
      const r = await ingest(sub);
      if (r === "new") counts.new += 1;
      else if (r === "duplicate") counts.duplicate += 1;
      else {
        counts.skipped += 1;
        counts.reasons.push(r);
      }
    }
    url = page.next;
  }
  return counts;
}

export async function farmersCsv(code: string) {
  const rows = await farmerListRows(code);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["name,label", ...rows.map((r) => `${esc(r.name)},${esc(r.label)}`)].join("\n") + "\n";
}

/**
 * Replaces farmers.csv on the readiness form and redeploys so devices and the web form get it.
 * Uses Kobo's asset files API (form_media).
 */
export async function pushFarmerList(code: string) {
  const k = koboConfig();
  const csv = await farmersCsv(code);
  const filesUrl = `${k.server}/api/v2/assets/${k.asset}/files/`;

  const existing = await fetch(`${filesUrl}?file_type=form_media`, { headers: k.headers, cache: "no-store" });
  if (!existing.ok) throw new Error(`Kobo returned ${existing.status} listing form media.`);
  const list = (await existing.json()) as { results: { uid: string; metadata?: { filename?: string } }[] };
  for (const f of list.results.filter((x) => x.metadata?.filename === "farmers.csv")) {
    await fetch(`${filesUrl}${f.uid}/`, { method: "DELETE", headers: k.headers });
  }

  // Kobo accepts media as base64 JSON; its multipart upload returned a server error in testing.
  const upload = await fetch(filesUrl, {
    method: "POST",
    headers: { ...k.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "default",
      file_type: "form_media",
      metadata: { filename: "farmers.csv" },
      base64Encoded: `data:text/csv;base64,${Buffer.from(csv).toString("base64")}`,
    }),
  });
  if (!upload.ok) throw new Error(`Kobo rejected the farmer list upload (${upload.status}): ${(await upload.text()).slice(0, 200)}`);

  // Redeploy so the new media reaches the web form and phones.
  const asset = await fetch(`${k.server}/api/v2/assets/${k.asset}/`, { headers: k.headers, cache: "no-store" });
  const { version_id } = (await asset.json()) as { version_id?: string };
  const redeploy = await fetch(`${k.server}/api/v2/assets/${k.asset}/deployment/`, {
    method: "PATCH",
    headers: { ...k.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ active: true, version_id }),
  });
  return { farmers: csv.trim().split("\n").length - 1, redeployed: redeploy.ok };
}

/* ---------- stored rows → review queue entries ---------- */

const str = (v: unknown) => (typeof v === "string" ? v : "");

function gpsOf(raw: unknown): [number, number] | null {
  const parts = str(raw).trim().split(/\s+/).map(Number);
  return parts.length >= 2 && parts.every((n) => !Number.isNaN(n)) ? [parts[0], parts[1]] : null;
}

type EvidenceRow = typeof s.evidence.$inferSelect;

export function toSubmission(row: EvidenceRow): Submission {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const status = row.reviewStatus;
  const decided = { decidedBy: row.reviewedBy ?? undefined, decidedOn: row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : undefined, note: row.queryNote ?? undefined };
  if (row.source !== "kobo") {
    // Seeded demo record: the payload is already a review-queue entry.
    return { ...(p as unknown as Submission), dbId: row.id, source: "sample", status, ...decided };
  }
  const ready = str(p.ready);
  const fields: Record<string, string> = {
    result: ready === "yes" ? "Yes" : ready === "no" ? "No" : "",
    visit_type: str(p.visit_type) === "recheck" ? "Recheck" : str(p.visit_type) ? "First visit" : "",
    both_present: str(p.both_present) === "yes" ? "Yes" : str(p.both_present) === "no" ? "No" : "",
  };
  if (ready === "no") fields.issue = str(p.issue);
  return {
    id: `KB-${p._id ?? row.koboSubmissionUuid?.slice(0, 8)}`,
    dbId: row.id,
    source: "kobo",
    orgId: row.organizationId ?? "",
    form: (row.form as SubmissionForm) ?? "readiness",
    farmerId: row.farmerCode ?? str(p.farmer),
    date: str(p.visit_date) || (row.completedAt ? row.completedAt.toISOString().slice(0, 10) : ""),
    enumerator: row.completedBy ?? "kobo",
    gps: gpsOf(p.location),
    fields,
    photo: !!str(p.photo),
    status,
    ...decided,
  };
}

export async function listSubmissions(code: string) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.evidence).where(eq(s.evidence.projectId, project.id)).orderBy(desc(s.evidence.createdAt));
  return { project, submissions: rows.filter((r) => r.form).map(toSubmission) };
}
