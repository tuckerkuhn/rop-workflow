import { ROLE_FOR } from "@/lib/evidence";
import { randomBytes } from "node:crypto";
import { db, schema as s } from "@/db";
import { STATUS_LABEL, SECTIONS } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { loadCopies } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";

/**
 * Read-only links for the donor: a quarter's report as frozen (the release, or the latest practice
 * copy), where each figure opens the records behind it. What a link shows is what the report already
 * gives the donor, plus the records' dates, places (province and district) and captioned photos.
 * Result notes and other documents (attendance sheets carry full names) are never opened from it.
 * Links expire, can be withdrawn, and every view is recorded.
 */

export type Share = { token: string; quarter: string; by: string; at: string; expires: string; revoked?: { by: string; at: string } };
const KEY = "shares";
export const SHARE_DAYS = 60;

export async function loadShares(code: string): Promise<Share[]> {
  const project = await projectByCode(code);
  return (await loadProjectState<{ shares: Share[] }>(project.id, KEY, { shares: [] })).shares;
}

async function saveShares(code: string, shares: Share[]) {
  const project = await projectByCode(code);
  await saveProjectState(project.id, KEY, { shares });
}

export async function createShare(code: string, quarter: string, by: string): Promise<Share> {
  const at = new Date();
  const share: Share = { token: randomBytes(24).toString("base64url"), quarter, by, at: at.toISOString(), expires: new Date(at.getTime() + SHARE_DAYS * 864e5).toISOString() };
  await saveShares(code, [...(await loadShares(code)), share]);
  const project = await projectByCode(code);
  await db.insert(s.auditLog).values({ projectId: project.id, entity: "share", entityId: project.id, action: "share_created", detail: { by, quarter, expires: share.expires, token: share.token.slice(0, 6) } });
  return share;
}

export async function revokeShare(code: string, token: string, by: string) {
  const list = await loadShares(code);
  const sh = list.find((x) => x.token === token);
  if (!sh || sh.revoked) return false;
  sh.revoked = { by, at: new Date().toISOString() };
  await saveShares(code, list);
  const project = await projectByCode(code);
  await db.insert(s.auditLog).values({ projectId: project.id, entity: "share", entityId: project.id, action: "share_revoked", detail: { by, quarter: sh.quarter, token: token.slice(0, 6) } });
  return true;
}

/** The donor's view behind a link, or why there is none. Records the view. */
export async function sharedReport(code: string, token: string, opts: { log: boolean } = { log: true }) {
  let project;
  try {
    project = await projectByCode(code);
  } catch {
    return { error: "This link does not work." } as const;
  }
  const sh = (await loadShares(code)).find((x) => x.token === token);
  if (!sh) return { error: "This link does not work." } as const;
  if (sh.revoked) return { error: "Roots of Peace has withdrawn this link." } as const;
  if (sh.expires < new Date().toISOString()) return { error: "This link has expired. Ask Roots of Peace for a new one." } as const;
  const copies = await loadCopies(code, sh.quarter);
  const copy = copies.find((c) => c.kind === "release") ?? copies.filter((c) => c.kind === "practice").at(-1);
  if (!copy) return { error: "This report is not ready to share yet." } as const;
  const d = copy.data;
  const counted = new Set(d.counted.map((c) => c.id));
  const { from, to } = quarterRange(sh.quarter);
  const results = (await loadResults(code)).filter((r) => counted.has(r.id) && r.date >= from && r.date <= to);
  if (opts.log) await db.insert(s.auditLog).values({ projectId: project.id, entity: "share", entityId: project.id, action: "share_viewed", detail: { by: null, quarter: sh.quarter, token: token.slice(0, 6) } });
  const sections = [
    ...SECTIONS.map((x) => ({ heading: x.heading as string, text: d.saved.sections[x.key]?.text ?? "" })),
    ...d.activities.map((a) => ({ heading: `Activity ${a.code}: ${a.name}`, text: d.saved.sections[`act.${a.code}`]?.text ?? "" })),
  ].filter((x) => x.text.trim());
  return {
    project: { name: d.project.name, donor: d.project.donor },
    quarter: sh.quarter,
    status: copy.kind === "release" ? ("released" as const) : ("draft" as const),
    asOf: copy.at,
    expires: sh.expires,
    rows: d.rows.map((r) => ({
      code: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      yearTarget: r.yearTarget,
      quarter: r.quarter,
      year: r.year,
      status: STATUS_LABEL[r.status],
      comment: r.comment,
      records: results
        .filter((x) => x.indicator === r.code)
        .map((x) => ({
          date: x.date,
          value: x.value,
          place: [x.district, x.province].filter(Boolean).join(", "),
          // To a donor, people appear by role (lib/evidence); the audit pack and the audit log keep the names.
          accepted: x.reviewedAt ? { by: ROLE_FOR.accepted, on: x.reviewedAt.slice(0, 10) } : null,
          photos: x.files.filter((f) => f.type.startsWith("image/") && x.captions?.[f.hash]).map((f) => ({ hash: f.hash, caption: x.captions![f.hash] })),
          documents: [...x.files.filter((f) => !(f.type.startsWith("image/") && x.captions?.[f.hash])).map((f) => f.name), ...(x.links ?? []).map((l) => l.title)],
        })),
    })),
    sections,
    photos: d.photos.map((p) => ({ hash: p.hash, caption: p.caption, activity: p.activity })),
  };
}
export type SharedReport = Exclude<Awaited<ReturnType<typeof sharedReport>>, { error: string }>;

/** Whether a link may show this file: only captioned photos in its report or behind its figures. */
export async function sharedPhoto(code: string, token: string, hash: string) {
  const v = await sharedReport(code, token, { log: false });
  if ("error" in v) return false;
  return v.photos.some((p) => p.hash === hash) || v.rows.some((r) => r.records.some((x) => x.photos.some((p) => p.hash === hash)));
}
