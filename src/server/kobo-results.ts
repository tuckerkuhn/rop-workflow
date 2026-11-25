import { isYouth } from "@/lib/field";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { YOUTH_AGES, type KoboBreakdown, type MappingMethod } from "@/lib/kobo-setup";
import type { Correction, ResultInput, ResultRecord } from "@/lib/results";
import { logAudit } from "@/server/audit";
import { attachmentBytes } from "@/server/kobo-client";
import { koboPlace } from "@/lib/kobo-photo";
import { breakdownFor, credentials, koboBreakdowns } from "@/server/kobo-link";
import { farmersOf } from "@/server/distribution";
import { countsPeople } from "@/lib/data-checks";
import { saveFile } from "@/server/hr-files";
import { koboMismatches, loadResults } from "@/server/results-store";

/**
 * KoboToolbox as the front door: every counted submission behind an indicator that takes results
 * becomes a result record, with its date, place, location and photos as proof, waiting for MEL
 * like any other. The indicator's mapping says what a submission adds (one, its answer, or one per
 * new answer). Runs after every sync; safe to repeat.
 *
 * While a result waits for MEL, it follows changes made in KoboToolbox. Once MEL has accepted it,
 * a change or a deletion in KoboToolbox is written to the audit log instead, for MEL to reopen
 * (once per change, however many times the sync runs).
 *
 * A result MEL queried has no person to correct it in the app: its recorder is the form. The fix
 * is made in KoboToolbox, and when it arrives here the result goes back to MEL as pending, with
 * the query and the earlier figures kept in its history. Without that it stayed queried for good.
 */

export const KOBO_BY = "kobo";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Sub = { id: string; uuid: string; num: number | null; /** The KoboCollect account that sent it. */ by: string | null; /** The farmer ID picked from farmers.csv, when the form names one. */ farmer: string; at: Date | null; payload: Record<string, unknown>; removed: boolean; form: string | null; review: string };

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
/** A form's answer by question path, or by its last part (Kobo may store either). */
function answer(p: Record<string, unknown>, q: string) {
  if (q in p) return text(p[q]);
  const last = q.split("/").at(-1)!;
  const k = Object.keys(p).find((x) => x === last || x.endsWith(`/${last}`));
  return k ? text(p[k]) : "";
}
/** The first answer to a question named province or district, wherever it sits in the form. */
const placeOf = (p: Record<string, unknown>, name: "province" | "district") => {
  const k = Object.keys(p).find((x) => new RegExp(`(^|/)${name}(_name)?$`, "i").test(x));
  const v = k ? text(p[k]) : "";
  return v ? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80) : undefined;
};
// The phone's own fix when the form was opened, else the GPS question, else KoboToolbox's reading (lib/kobo-photo).
const gpsOf = (p: Record<string, unknown>) => {
  const at = koboPlace(p);
  return at ? { lat: at.lat, lon: at.lon } : undefined;
};

/**
 * When the work happened: the form's own date question (install_date, training_date, date...) when
 * it has one, else the day KoboToolbox received the submission. A form date after the submission
 * arrived, or one that is not a real date, is not trusted. Kobo's own start, end and today stamps
 * are when the form was filled, not when the work was done, so they are not used.
 */
function dateOf(p: Record<string, unknown>, received: string): string {
  const key = Object.keys(p).find((k) => {
    const last = k.split("/").at(-1)!.toLowerCase();
    return !k.startsWith("_") && !["start", "end", "today"].includes(last) && /(^|_)date($|_)/.test(last);
  });
  const v = key ? text(p[key]).slice(0, 10) : "";
  const real = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  return real && (!received || v <= received) ? v : received;
}

/** What one submission adds to its indicator; 0 = it does not count. `seen` tracks answers already counted for count_unique. */
function addsUp(method: MappingMethod, value: string | null, a: string, seen: Set<string>) {
  if (!a) return 0;
  if (method === "count_answer") return a.split(/\s+/).includes(value ?? "") ? 1 : 0;
  if (method === "sum") return Number.isFinite(Number(a)) ? Number(a) : 0;
  if (method === "count_unique") {
    if (seen.has(a)) return 0;
    seen.add(a);
    return 1;
  }
  return 1;
}

type People = { female?: number; male?: number; youth?: number };

/** What a farmer record says about one farmer: their sex and age band (lib/field Farmer). */
type FarmerFacts = { gender?: string; ageBand?: string } | null | undefined;

/**
 * Women, men and young people one submission counts, from the questions its indicator's mapping
 * names (lib/kobo-setup KoboBreakdown). Only numbers come out: never the answer itself. A question
 * not mapped, not answered or answered with something unexpected leaves its figure empty.
 *
 * `farmer`: the record of the farmer the submission names, when the indicator counts people and
 * each submission is one farmer. It gives the sex and the age when no question is mapped for them
 * (a mapped question wins, even unanswered). Its age band says young (18 to 29) or not (50 and
 * over); 30 to 49 may or may not be 35 or under, so it is left empty.
 */
function breakdownOf(b: KoboBreakdown | null | undefined, p: Record<string, unknown>, farmer?: FarmerFacts): People {
  const out: People = {};
  if (b?.shape === "counts") {
    // A group per submission: the farmer record says nothing about it.
    const n = (q: string | null) => {
      const a = q ? answer(p, q) : "";
      const x = a === "" ? NaN : Number(a);
      return Number.isInteger(x) && x >= 0 && x <= 1e7 ? x : undefined;
    };
    const [female, male, youth] = [n(b.women), n(b.men), n(b.youth)];
    if (female !== undefined) out.female = female;
    if (male !== undefined) out.male = male;
    if (youth !== undefined) out.youth = youth;
  } else {
    if (b?.sex && b.female && b.male) {
      const sex = answer(p, b.sex).split(/\s+/);
      const isF = sex.includes(b.female);
      const isM = sex.includes(b.male);
      // Both or neither: not one person's sex, so not counted either way.
      if (isF !== isM) Object.assign(out, { female: isF ? 1 : 0, male: isM ? 1 : 0 });
    } else if (farmer?.gender === "Female" || farmer?.gender === "Male") Object.assign(out, { female: farmer.gender === "Female" ? 1 : 0, male: farmer.gender === "Male" ? 1 : 0 });
    if (b?.age) {
      const a = answer(p, b.age);
      if (a && b.young) out.youth = a.split(/\s+/).includes(b.young) ? 1 : 0;
      else if (a && Number.isFinite(Number(a)) && Number(a) > 0) out.youth = Number(a) >= YOUTH_AGES.from && Number(a) <= YOUTH_AGES.to ? 1 : 0;
    } else if (isYouth(farmer?.ageBand) !== null) out.youth = isYouth(farmer?.ageBand) ? 1 : 0;
  }
  // More young people than people is not a figure a result can hold (lib/results): leave it out.
  if (out.youth !== undefined && (out.female !== undefined || out.male !== undefined) && out.youth > (out.female ?? 0) + (out.male ?? 0)) delete out.youth;
  return out;
}

/** The farmer ID a submission names: set by the sync on reviewed forms, else the form's farmer answer. A fingerprint is not an ID. */
const farmerIdOf = (code: string | null, p: Record<string, unknown>) => {
  const v = text(code) || text(p.farmer);
  return v.startsWith("pseudonym:") ? "" : v.slice(0, 80);
};

const samePeople = (r: People, b: People) => r.female === b.female && r.male === b.male && r.youth === b.youth;
const peopleOf = (r: People): People => ({ ...(r.female !== undefined ? { female: r.female } : {}), ...(r.male !== undefined ? { male: r.male } : {}), ...(r.youth !== undefined ? { youth: r.youth } : {}) });

export type KoboResultCounts = { added: number; updated: number; removed: number; flagged: number; photos: number };

/** A value written the same way whatever order its keys were stored in (the database does not keep key order). */
const canon = (v: unknown): string =>
  v && typeof v === "object"
    ? Array.isArray(v)
      ? `[${v.map(canon).join(",")}]`
      : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(v ?? null);

/**
 * Notes that an accepted result no longer matches KoboToolbox, once per change. The sync runs after
 * every submission and every night, so without this the same change was written to the audit log
 * on each run. Returns whether a new row was written.
 */
async function flagOnce(projectId: string, resultId: string, detail: Record<string, unknown>) {
  const [last] = await db
    .select({ action: s.auditLog.action, detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.entityId, resultId), inArray(s.auditLog.action, ["kobo_changed_after_acceptance", "kobo_matches_again"])))
    .orderBy(desc(s.auditLog.at), desc(s.auditLog.sequence))
    .limit(1);
  if (last?.action === "kobo_changed_after_acceptance" && canon(last.detail ?? {}) === canon({ by: KOBO_BY, ...detail })) return false;
  await logAudit(db, projectId, { entity: "result", entityId: resultId, action: "kobo_changed_after_acceptance", by: KOBO_BY, detail });
  return true;
}

/** What is stored for a result: the record without the fields the store adds when reading it. */
function stored(r: ResultRecord): ResultInput {
  const { id: _id, quarter: _q, status: _s, by: _b, at: _a, reviewedBy: _rb, reviewedAt: _ra, query: _qu, history: _h, ...input } = r;
  void [_id, _q, _s, _b, _a, _rb, _ra, _qu, _h];
  return input;
}

export async function koboToResults(code: string): Promise<KoboResultCounts> {
  const out: KoboResultCounts = { added: 0, updated: 0, removed: 0, flagged: 0, photos: 0 };
  const c = await credentials(code);
  const project = c.project;
  const maps = await db
    .select({ m: s.koboMappings, ind: s.indicators })
    .from(s.koboMappings)
    .innerJoin(s.indicators, eq(s.indicators.id, s.koboMappings.indicatorId))
    .where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results")));
  if (!maps.length) return out;
  const approvedOnly = c.connection.countOnly === "approved";
  const linked = await db.select().from(s.koboForms).where(eq(s.koboForms.projectId, project.id));
  const forms = new Map(linked.map((f) => [f.assetUid, f.name]));
  // Input distributions count toward the target the input package names, when the project
  // manager approves each one (server/distribution). A mapping on a distribution form is skipped,
  // so a farmer is never counted twice.
  const distributionForms = new Set(linked.filter((f) => f.purpose === "distribution").map((f) => f.assetUid));
  const existing = (await loadResults(code)).filter((r) => r.kobo);
  const mismatched = await koboMismatches(project.id);
  const breakdowns = await koboBreakdowns(project.id);

  for (const { m, ind } of maps) {
    if (distributionForms.has(m.assetUid)) continue;
    const rows = await db
      .select()
      .from(s.evidence)
      .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.koboAssetUid, m.assetUid), eq(s.evidence.source, "kobo")))
      .orderBy(asc(s.evidence.completedAt));
    const subs: Sub[] = rows
      .filter((r) => r.koboSubmissionUuid)
      .map((r) => ({ id: r.id, uuid: r.koboSubmissionUuid!, num: r.koboSubmissionId, by: r.completedBy, at: r.completedAt, payload: (r.payload as Record<string, unknown>) ?? {}, removed: !!r.koboRemovedAt, form: r.form, review: r.reviewStatus, farmer: farmerIdOf(r.farmerCode, (r.payload as Record<string, unknown>) ?? {}) }));
    const seen = new Set<string>();
    const breakdown = breakdownFor(breakdowns, ind.code, m.assetUid);
    // One submission is one farmer only on a target counted in people (not hectares or kilograms):
    // there the farmer record gives the sex and age no mapped question gives.
    const farmers = countsPeople(ind.unit) ? await farmersOf(project.id, subs.map((x) => x.farmer)) : new Map<string, FarmerFacts>();
    // Results matched to a submission on this form; any other result from this form and target is left over.
    const matched = new Set<string>();
    for (const sub of subs) {
      // An edit in KoboToolbox gives the submission a new _uuid but keeps its number: match either.
      const mine = existing.find((r) => r.indicator === ind.code && !matched.has(r.id) && (r.kobo?.uuid === sub.uuid || (sub.num !== null && r.kobo?.asset === m.assetUid && r.kobo?.id === sub.num)));
      if (mine) matched.add(mine.id);
      // Keep the link to the submission's current _uuid (metadata only: the figure is handled below).
      if (mine && mine.kobo && mine.kobo.uuid !== sub.uuid) {
        const kobo = { ...mine.kobo, uuid: sub.uuid };
        await db.update(s.evidence).set({ payload: { ...stored(mine), kobo }, updatedAt: new Date() }).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.id, mine.id)));
        mine.kobo = kobo;
      }
      // Counted the same way as before: readiness submissions once accepted, and only approved ones when the project says so.
      const counts = !sub.removed && (sub.form === null || sub.review === "accepted") && (!approvedOnly || text((sub.payload._validation_status as { uid?: string } | undefined)?.uid) === "validation_status_approved");
      const value = counts ? addsUp(m.method as MappingMethod, m.value, answer(sub.payload, m.question), seen) : 0;
      const date = dateOf(sub.payload, (sub.at?.toISOString() ?? text(sub.payload._submission_time) ?? "").slice(0, 10));
      const where = and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"));

      if (!value) {
        if (!mine) continue;
        if (mine.status === "accepted") {
          await flagOnce(project.id, mine.id, { indicator: ind.code, submission: sub.num, change: sub.removed ? "deleted in KoboToolbox" : "no longer counts" });
          out.flagged++;
        } else {
          await db.transaction(async (tx) => {
            await tx.delete(s.evidence).where(and(where, eq(s.evidence.id, mine.id)));
            await logAudit(tx, project.id, { entity: "result", entityId: mine.id, action: "kobo_result_removed", by: KOBO_BY, detail: { indicator: ind.code, submission: sub.num } });
          });
          out.removed++;
        }
        continue;
      }

      const province = placeOf(sub.payload, "province");
      const district = placeOf(sub.payload, "district");
      const gps = gpsOf(sub.payload);
      const formName = forms.get(m.assetUid) ?? "KoboToolbox form";
      const people = breakdownOf(breakdown, sub.payload, farmers.get(sub.farmer));
      const note = `From KoboToolbox: "${formName}", submission ${sub.num ?? sub.uuid.slice(0, 8)}${district || province ? `, ${[district, province].filter(Boolean).join(", ")}` : ""}.`;

      if (mine) {
        const moved = mine.value !== value || mine.date !== date || (mine.province ?? "") !== (province ?? "") || (mine.district ?? "") !== (district ?? "");
        // Women, men and young people follow the form too: filled in on the next sync after they are mapped.
        const changed = moved || !samePeople(mine, people);
        if (!changed) {
          // It had been noted as changed after acceptance and now agrees again (the edit was undone in KoboToolbox).
          if (mine.status === "accepted" && mismatched.delete(mine.id)) await logAudit(db, project.id, { entity: "result", entityId: mine.id, action: "kobo_matches_again", by: KOBO_BY, detail: { indicator: ind.code, submission: sub.num, value, date } });
          continue;
        }
        if (mine.status === "accepted") {
          await flagOnce(project.id, mine.id, { indicator: ind.code, submission: sub.num, was: { value: mine.value, date: mine.date, ...peopleOf(mine) }, now: { value, date, ...people } });
          out.flagged++;
          continue;
        }
        // Queried by MEL and now corrected in KoboToolbox (or its women and men now filled in from the
        // form or the farmer record): back to MEL, with the query and the old figures kept.
        const answered = mine.status === "queried";
        const reply = moved ? "Corrected in KoboToolbox" : "Women, men and young people filled in from the form or the farmer record";
        const history: Correction[] = [...(mine.history ?? []), ...(answered ? [{ at: new Date().toISOString(), by: KOBO_BY, query: mine.query, reply, previous: { value: mine.value, date: mine.date, ...(mine.province ? { province: mine.province } : {}), ...(mine.district ? { district: mine.district } : {}), ...peopleOf(mine) } }] : [])];
        const { female: _f, male: _m, youth: _y, ...rest } = stored(mine);
        void [_f, _m, _y];
        const payload: ResultInput & { history?: Correction[] } = { ...rest, value, date, province, district, gps, ...people, ...(history.length ? { history } : {}) };
        await db.transaction(async (tx) => {
          await tx
            .update(s.evidence)
            .set({ payload, completedAt: new Date(`${date}T12:00:00Z`), location: [district, province].filter(Boolean).join(", ") || null, updatedAt: new Date(), ...(answered ? { reviewStatus: "pending" as const, reviewedBy: null, reviewedAt: null, queryNote: null } : {}) })
            .where(and(where, eq(s.evidence.id, mine.id)));
          await logAudit(tx, project.id, { entity: "result", entityId: mine.id, action: answered ? "result_corrected" : "kobo_result_updated", by: KOBO_BY, detail: { indicator: ind.code, submission: sub.num, value, date, ...people, ...(answered ? { query: mine.query, reply, before: { value: mine.value, date: mine.date, ...peopleOf(mine) }, after: { value, date, ...people } } : {}) } });
        });
        out.updated++;
        continue;
      }

      // New: its photos become the proof, captioned so they can go into the report.
      const files: ResultInput["files"] = [];
      const captions: Record<string, string> = {};
      const taken: Record<string, string> = {};
      const atts = Array.isArray(sub.payload._attachments) ? (sub.payload._attachments as Record<string, unknown>[]) : [];
      for (const att of atts.slice(0, 10)) {
        if (!PHOTO_TYPES.includes(text(att.mimetype))) continue;
        const url = text(att.download_url) || text(att.download_large_url);
        if (!url) continue;
        try {
          const got = await attachmentBytes(c.server, c.token, url);
          if (!got || !PHOTO_TYPES.includes(got.type || text(att.mimetype))) continue;
          const name = (text(att.filename).split("/").at(-1) || "photo.jpg").slice(0, 120);
          const f = await saveFile(got.bytes, name, got.type || text(att.mimetype), KOBO_BY);
          files.push(f);
          captions[f.hash] = `${ind.name}${district || province ? `, ${[district, province].filter(Boolean).join(", ")}` : ""}, ${date}`.slice(0, 300);
          taken[f.hash] = date;
          out.photos++;
        } catch {
          /* a photo that cannot be fetched is left out; the submission still counts */
        }
      }
      const input: ResultInput = {
        indicator: ind.code,
        date,
        value,
        ...people,
        ...(province ? { province } : {}),
        ...(district ? { district } : {}),
        note,
        files,
        ...(Object.keys(captions).length ? { captions, taken } : {}),
        ...(files.length ? {} : { noFile: "From a KoboToolbox submission with no photo" }),
        ...(gps ? { gps } : {}),
        kobo: { asset: m.assetUid, uuid: sub.uuid, ...(sub.num !== null ? { id: sub.num } : {}), ...(sub.by ? { by: sub.by.slice(0, 120) } : {}) },
      };
      await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(s.evidence)
          .values({ organizationId: project.organizationId, projectId: project.id, source: "manual", form: "result", reviewStatus: "pending", completedBy: KOBO_BY, completedAt: new Date(`${date}T12:00:00Z`), location: [district, province].filter(Boolean).join(", ") || null, payload: input })
          .returning({ id: s.evidence.id });
        await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: "result_recorded", by: KOBO_BY, detail: { indicator: ind.code, value, date, ...people, proof: files.length, submission: sub.num } });
      });
      out.added++;
    }

    // Left over: a result from this form and target that no submission matches any more (a copy
    // made by an edit before submission numbers were matched, or a submission gone from the
    // records). Waiting for MEL, it is removed; accepted, it is flagged and kept.
    for (const r of existing.filter((x) => x.indicator === ind.code && x.kobo?.asset === m.assetUid && !matched.has(x.id))) {
      if (r.status === "accepted") {
        await flagOnce(project.id, r.id, { indicator: ind.code, submission: r.kobo?.id ?? null, change: "no matching submission in KoboToolbox" });
        out.flagged++;
        continue;
      }
      await db.transaction(async (tx) => {
        await tx.delete(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.form, "result"), eq(s.evidence.id, r.id)));
        await logAudit(tx, project.id, { entity: "result", entityId: r.id, action: "kobo_result_removed", by: KOBO_BY, detail: { indicator: ind.code, submission: r.kobo?.id ?? null, reason: "no matching submission in KoboToolbox" } });
      });
      out.removed++;
    }
  }
  return out;
}

/** The pure rules above, for tests. */
export const koboResultRules = { answer, placeOf, gpsOf, addsUp, dateOf, breakdownOf };
