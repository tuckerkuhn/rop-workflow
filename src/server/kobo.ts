import { desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Submission, SubmissionForm } from "@/lib/project";
import { farmerListRows, projectByCode } from "@/server/field-store";
import { readinessForms } from "@/server/kobo-link";

/**
 * Readiness checks from KoboToolbox: the farmer list pushed to the project's readiness form as
 * media, and stored rows mapped into review-queue entries. Submissions come in through the
 * project's own Kobo link (server/kobo-link.ts), by sync or automatic sync.
 */

export async function farmersCsv(code: string) {
  const rows = await farmerListRows(code);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["name,label", ...rows.map((r) => `${esc(r.name)},${esc(r.label)}`)].join("\n") + "\n";
}

/**
 * Replaces farmers.csv on the project's readiness form(s) and redeploys so devices and the web
 * form get it. Uses the project's own Kobo link and Kobo's asset files API (form_media).
 */
export async function pushFarmerList(code: string) {
  const k = await readinessForms(code);
  const headers = { Authorization: `Token ${k.token}`, Accept: "application/json" };
  const csv = await farmersCsv(code);
  let redeployed = true;
  for (const form of k.forms) {
    const asset = `${k.server}/api/v2/assets/${encodeURIComponent(form.assetUid)}`;
    const filesUrl = `${asset}/files/`;

    const existing = await fetch(`${filesUrl}?file_type=form_media`, { headers, cache: "no-store" });
    if (!existing.ok) throw new Error(`Kobo returned ${existing.status} listing form media on ${form.name}.`);
    const list = (await existing.json()) as { results: { uid: string; metadata?: { filename?: string } }[] };
    for (const f of list.results.filter((x) => x.metadata?.filename === "farmers.csv")) {
      await fetch(`${filesUrl}${f.uid}/`, { method: "DELETE", headers });
    }

    // Kobo accepts media as base64 JSON; its multipart upload returned a server error in testing.
    const upload = await fetch(filesUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "default",
        file_type: "form_media",
        metadata: { filename: "farmers.csv" },
        base64Encoded: `data:text/csv;base64,${Buffer.from(csv).toString("base64")}`,
      }),
    });
    if (!upload.ok) throw new Error(`Kobo rejected the farmer list upload on ${form.name} (${upload.status}): ${(await upload.text()).slice(0, 200)}`);

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
    Object.assign(fields, { gender: str(p._rop_gender), seed_kg: str(p.seed_kg), npk_kg: str(p.npk_kg), signature: str(p.signed) === "yes" ? "Yes" : "Not confirmed" });
  }
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
    photo: !!str(p.photo) || !!str(p.list_photo),
    status,
    ...decided,
  };
}

export async function listSubmissions(code: string) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.evidence).where(eq(s.evidence.projectId, project.id)).orderBy(desc(s.evidence.createdAt));
  // A pending check deleted in KoboToolbox leaves the queue; decided ones stay as history.
  return { project, submissions: rows.filter((r) => r.form && !(r.koboRemovedAt && r.reviewStatus === "pending")).map(toSubmission) };
}
