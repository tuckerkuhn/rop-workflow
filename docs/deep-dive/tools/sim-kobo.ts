// LOCAL TESTING ONLY. Makes fictional KoboCollect records on the demo project A-2027 in the throwaway
// local database, with photos served by fake-kobo.mjs, so the KoboCollect path can be walked without a
// KoboToolbox account. Refuses to run against anything but localhost. Never part of the app.
//
//   cp docs/deep-dive/tools/sim-kobo.ts ./.sim.ts && npx tsx --env-file=.env.local ./.sim.ts <kind> [nophoto]; rm ./.sim.ts
//   kind: distribution | readiness
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { encryptSecret } from "@/server/secrets";
import { projectByCode } from "@/server/field-store";
import type { Farmer } from "@/lib/field";

async function main() {
  if (!/@localhost[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("This script only runs against the local test database.");
  const [kind = "distribution", flag] = process.argv.slice(2);
  const project = await projectByCode("A-2027");
  await db.insert(s.koboConnections).values({ projectId: project.id, serverUrl: "http://localhost:4010", tokenEncrypted: encryptSecret("fake-token"), tokenHint: "oken", connectedBy: "nadia" }).onConflictDoNothing();
  const farmers = (await db.select().from(s.fieldItems).where(eq(s.fieldItems.projectId, project.id))).map((i) => i.data as Farmer).filter((f) => (f as { kind?: string }).kind === "farmer");
  const want = kind === "distribution" ? "distribute" : "verify";
  const f = farmers.find((x) => x.step === want && !x.awaiting) ?? farmers[0];
  const n = Date.now() % 100000;
  const uuid = `sim-${kind}-${n}`;
  const base = `http://localhost:4010/api/v2/assets/aSim/data/${n}/attachments`;
  const att = (name: string, question: string, i: number) => ({ download_url: `${base}/${i}/${name}`, download_medium_url: `${base}/${i}/${name}`, mimetype: "image/jpeg", filename: `rop/attachments/aSim/sim/${name}`, question_xpath: question, media_file_basename: name });
  const photo = flag !== "nophoto";
  const payload: Record<string, unknown> =
    kind === "distribution"
      ? { _id: n, farmer: f.id, distribution_date: new Date().toISOString().slice(0, 10), seed_kg: "10", npk_kg: "50", condition: "good", signed: "yes", start_geopoint: "34.562 69.21 1790 6", notes: "Handed over at the store", _submitted_by: "bilal.kobo", ...(photo ? { list_photo: "note.jpg", handover_photo: "handover.jpg", _attachments: [att("note.jpg", "list_photo", 1), att("handover.jpg", "handover_photo", 2)] } : { _attachments: [] }) }
      : { _id: n, farmer: f.id, visit_date: new Date().toISOString().slice(0, 10), visit_type: "first", both_present: "yes", ready: "yes", location: "34.5621 69.2103 1790 5", start_geopoint: "34.562 69.21 1790 6", _submitted_by: "farida.kobo", ...(photo ? { photo: "note.jpg", _attachments: [att("note.jpg", "photo", 1)] } : { _attachments: [] }) };
  await db.delete(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.koboSubmissionUuid, uuid)));
  const [row] = await db
    .insert(s.evidence)
    .values({ organizationId: project.organizationId, projectId: project.id, source: "kobo", form: kind === "distribution" ? "distribution" : "readiness", farmerCode: f.id, reviewStatus: "pending", completedBy: String(payload._submitted_by), completedAt: new Date(), koboAssetUid: "aSim", koboSubmissionUuid: uuid, koboSubmissionId: n, payload })
    .returning({ id: s.evidence.id });
  console.log(JSON.stringify({ kind, id: row.id, farmer: f.id, approve: kind === "distribution" ? `/approve/A-2027/${row.id}` : "/progress/results" }));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
