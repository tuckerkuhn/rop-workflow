import { ROLE_FOR } from "@/lib/evidence";
import { donorPhotoRule } from "@/server/photo-consent";
import { randomBytes } from "node:crypto";
import { db, schema as s } from "@/db";
import { SECTIONS } from "@/lib/qpr";
import { targetStatus, targetStatusText } from "@/lib/target-status";
import { quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";
import type { ReportCopy } from "@/lib/report-copy";
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

/** Changes the list of links with it locked, so links made or withdrawn at the same moment all stay. */
async function changeShares<R>(code: string, change: (shares: Share[]) => { shares: Share[] | null; result: R }): Promise<R> {
  const project = await projectByCode(code);
  return updateProjectState<{ shares: Share[] }, R>(project.id, KEY, { shares: [] }, async (cur) => {
    const { shares, result } = change(cur.shares);
    return { data: shares ? { shares } : null, result };
  });
}

export async function createShare(code: string, quarter: string, by: string): Promise<Share> {
  const at = new Date();
  const share: Share = { token: randomBytes(24).toString("base64url"), quarter, by, at: at.toISOString(), expires: new Date(at.getTime() + SHARE_DAYS * 864e5).toISOString() };
  await changeShares(code, (list) => ({ shares: [...list, share], result: null }));
  const project = await projectByCode(code);
  await db.insert(s.auditLog).values({ projectId: project.id, entity: "share", entityId: project.id, action: "share_created", detail: { by, quarter, expires: share.expires, token: share.token.slice(0, 6) } });
  return share;
}

export async function revokeShare(code: string, token: string, by: string) {
  const sh = await changeShares(code, (list) => {
    const found = list.find((x) => x.token === token);
    if (!found || found.revoked) return { shares: null, result: null };
    const revoked = { ...found, revoked: { by, at: new Date().toISOString() } };
    return { shares: list.map((x) => (x.token === token ? revoked : x)), result: revoked };
  });
  if (!sh) return false;
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
  if (opts.log) await db.insert(s.auditLog).values({ projectId: project.id, entity: "share", entityId: project.id, action: "share_viewed", detail: { by: null, quarter: sh.quarter, token: token.slice(0, 6) } });
  return { ...(await donorSafeReport(code, project.id, sh.quarter, copy)), expires: sh.expires };
}

/**
 * A frozen copy of a quarter's report as a donor may see it: the figures, the records behind
 * each (date, district and province, captioned photos the consent rule allows), the written
 * sections and the photos. People appear by role, never by name. One builder for the emailed link
 * and for a donor's own account (server/donor-view-store), so the two can never differ.
 */
export async function donorSafeReport(code: string, projectId: string, quarter: string, copy: ReportCopy) {
  const d = copy.data;
  // Photos follow the consent rule as it stands now (server/photo-consent), also in copies made before it existed.
  const photoOk = await donorPhotoRule(projectId);
  const counted = new Set(d.counted.map((c) => c.id));
  const { from, to } = quarterRange(quarter);
  const results = (await loadResults(code)).filter((r) => counted.has(r.id) && r.date >= from && r.date <= to);
  const sections = [
    ...SECTIONS.map((x) => ({ heading: x.heading as string, text: d.saved.sections[x.key]?.text ?? "" })),
    ...d.activities.map((a) => ({ heading: `Activity ${a.code}: ${a.name}`, text: d.saved.sections[`act.${a.code}`]?.text ?? "" })),
  ].filter((x) => x.text.trim());
  return {
    project: { name: d.project.name, donor: d.project.donor },
    quarter,
    status: copy.kind === "release" ? ("released" as const) : ("draft" as const),
    asOf: copy.at,
    rows: d.rows.map((r) => ({
      code: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      yearTarget: r.yearTarget,
      quarter: r.quarter,
      year: r.year,
      // The shared wording (lib/target-status), as of the report's quarter; only the Word file keeps UNDP's terms.
      status: targetStatusText(targetStatus(r, Number(quarter.slice(-1)))),
      comment: r.comment,
      records: results
        .filter((x) => x.indicator === r.code)
        .map((x) => ({
          date: x.date,
          value: x.value,
          place: [x.district, x.province].filter(Boolean).join(", "),
          // To a donor, people appear by role (lib/evidence); the audit pack and the audit log keep the names.
          accepted: x.reviewedAt ? { by: ROLE_FOR.accepted, on: x.reviewedAt.slice(0, 10) } : null,
          photos: x.files.filter((f) => f.type.startsWith("image/") && x.captions?.[f.hash] && photoOk(f.hash).ok).map((f) => ({ hash: f.hash, caption: x.captions![f.hash] })),
          documents: [...x.files.filter((f) => !(f.type.startsWith("image/") && x.captions?.[f.hash])).map((f) => f.name), ...(x.links ?? []).map((l) => l.title)],
        })),
    })),
    sections,
    photos: d.photos.filter((p) => photoOk(p.hash).ok).map((p) => ({ hash: p.hash, caption: p.caption, activity: p.activity })),
  };
}
export type DonorSafeReport = Awaited<ReturnType<typeof donorSafeReport>>;
export type SharedReport = Exclude<Awaited<ReturnType<typeof sharedReport>>, { error: string }>;

/** Whether a link may show this file: only captioned photos in its report or behind its figures. */
export async function sharedPhoto(code: string, token: string, hash: string) {
  const v = await sharedReport(code, token, { log: false });
  if ("error" in v) return false;
  return v.photos.some((p) => p.hash === hash) || v.rows.some((r) => r.records.some((x) => x.photos.some((p) => p.hash === hash)));
}
