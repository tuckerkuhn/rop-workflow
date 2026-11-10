import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import {
  isPhotoFile,
  periodFigures,
  qprFigures,
  ROLE_FOR,
  type Figure,
  type ProofResult,
} from "@/lib/evidence";
import { periodRange } from "@/lib/period-report";
import { withoutNames } from "@/lib/personal-text";
import { personName } from "@/lib/project";
import { quarterRange, type ResultRecord } from "@/lib/results";
import { loadActuals } from "@/server/actuals-store";
import { projectByCode, donorNameOf } from "@/server/field-store";
import { donorPhotoRule } from "@/server/photo-consent";
import { periodReport } from "@/server/period-report-store";
import { projectRules } from "@/server/policy-store";
import { loadCopies, qprData } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";
import { selfAcceptedResults, selfApprovedIn } from "@/server/solo";

/**
 * The proof behind reported figures (lib/evidence): the accepted results behind a figure, the
 * source of a spending figure, and the evidence pack's index for a report.
 */

const toProof = (r: ResultRecord, unit: string): ProofResult => ({
  id: r.id,
  indicator: r.indicator,
  date: r.date,
  value: r.value,
  unit,
  province: r.province ?? "",
  district: r.district ?? "",
  note: r.note,
  recordedBy: r.by,
  acceptedBy: r.reviewedBy,
  acceptedAt: r.reviewedAt,
  files: r.files.map((f) => ({
    hash: f.hash,
    name: f.name,
    type: f.type,
    caption: r.captions?.[f.hash] ?? "",
  })),
  links: r.links ?? [],
  kobo: r.kobo
    ? {
        asset: r.kobo.asset,
        ...(r.kobo.id !== undefined ? { id: r.kobo.id } : {}),
      }
    : null,
  noFile: r.noFile ?? null,
});

/** Accepted results that count toward a figure; `asOf` keeps only what was accepted by then (a released report). */
const counted = (
  results: ResultRecord[],
  indicator: string,
  from: string | null,
  to: string,
  asOf?: string,
) =>
  results
    .filter(
      (r) =>
        r.indicator === indicator &&
        r.status === "accepted" &&
        (!from || r.date >= from) &&
        r.date <= to &&
        (!asOf || (r.reviewedAt ?? "") <= asOf),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

/** The proof panel: the accepted results behind one indicator's figure for a period. */
export async function proofFor(
  code: string,
  indicator: string,
  from: string | null,
  to: string,
) {
  const p = await projectByCode(code);
  const [ind] = await db
    .select({
      code: s.indicators.code,
      donorCode: s.indicators.donorCode,
      name: s.indicators.name,
      unit: s.indicators.unit,
    })
    .from(s.indicators)
    .where(
      and(eq(s.indicators.projectId, p.id), eq(s.indicators.code, indicator)),
    )
    .limit(1);
  if (!ind) return null;
  const list = counted(await loadResults(code), indicator, from, to);
  return {
    indicator: {
      code: ind.code,
      donorCode: ind.donorCode ?? ind.code,
      name: ind.name,
      unit: ind.unit,
    },
    from,
    to,
    total: list.reduce((t, r) => t + r.value, 0),
    results: list.map((r) => toProof(r, ind.unit)),
  };
}
export type ProofView = NonNullable<Awaited<ReturnType<typeof proofFor>>>;

/** Where spending figures come from: Finance's workbook as imported, and who imported it. */
export async function moneySource(code: string) {
  const a = await loadActuals(code);
  return a.imports.map((i) => ({
    file: i.file.name,
    sharepointUrl: i.file.sharepointUrl,
    by: i.by,
    at: i.at,
    months: i.months,
    currency: i.currency,
    lines: i.lines.length,
  }));
}
export type MoneySource = Awaited<ReturnType<typeof moneySource>>;

export type PackKind = "donor" | "audit";
export type PackFile = ProofFile & { include: boolean; why: string };
type ProofFile = ProofResult["files"][number];

/**
 * The evidence pack's index for a quarterly or annual report: every figure with a reference, the
 * results behind it, each file marked included or held by ROP, the period's audit log extract,
 * and Finance's figures where they go in. Built from the released copy when there is one.
 */
export async function packIndex(
  code: string,
  report: { kind: "qpr"; quarter: string } | { kind: "annual"; year: number },
  kind: PackKind,
) {
  const p = await projectByCode(code);
  const results = await loadResults(code);
  let figures: Figure[];
  let label: string;
  let asOf: string | undefined;
  let from: string;
  let to: string;
  if (report.kind === "qpr") {
    ({ from, to } = quarterRange(report.quarter));
    const release = (await loadCopies(code, report.quarter)).find(
      (c) => c.kind === "release",
    );
    const rows = release
      ? release.data.rows
      : (await qprData(code, report.quarter)).rows;
    asOf = release?.at;
    figures = qprFigures(rows, report.quarter, from, to);
    label = `Quarterly report ${report.quarter.replace("-", " ")}`;
  } else {
    const v = await periodReport(code, { kind: "annual", year: report.year });
    ({ from, to } = periodRange(
      { kind: "annual", year: report.year },
      v.project.start,
      v.project.end,
    ));
    figures = periodFigures(
      v.rows,
      from,
      to,
      String(report.year),
      (c, f, t) => counted(results, c, f, t).length,
    );
    label = `Annual report ${report.year}`;
  }
  const photoOk = await donorPhotoRule(p.id);
  const fileFor = (f: ProofFile): PackFile => {
    if (kind === "audit") return { ...f, include: true, why: "" };
    if (!isPhotoFile(f))
      return {
        ...f,
        include: false,
        why: "A document (attendance sheets and forms can name people): held by Roots of Peace, available for verification.",
      };
    const ok = photoOk(f.hash);
    return ok.ok ? { ...f, include: true, why: "" } : { ...f, include: false, why: `Held by Roots of Peace: ${ok.why}` };
  };
  const units = new Map(figures.map((f) => [f.indicator, f.unit]));
  const entries = figures
    .filter((f) => f.ref)
    .map((f) => ({
      ...f,
      results: counted(results, f.indicator, f.from, f.to, asOf).map((r) => {
        const x = toProof(r, units.get(r.indicator) ?? "");
        return {
          ...x,
          selfApproved: false,
          note: kind === "donor" ? withoutNames(x.note) : x.note,
          recordedBy:
            kind === "donor" ? ROLE_FOR.recorded : personName(x.recordedBy),
          acceptedBy:
            kind === "donor"
              ? ROLE_FOR.accepted
              : x.acceptedBy && personName(x.acceptedBy),
          files: x.files.map(fileFor),
        };
      }),
    }));

  // The audit log for the period: what happened to these results, and to the report.
  const ids = [...new Set(entries.flatMap((e) => e.results.map((r) => r.id)))];
  // Solo mode (server/solo.ts): results their recorder accepted themselves are marked in both packs.
  const selfAccepted = await selfAcceptedResults(p.id, ids);
  for (const e of entries) for (const r of e.results) Object.assign(r, { selfApproved: selfAccepted.has(r.id) });
  const until = asOf ? new Date(asOf) : new Date();
  const log = await db
    .select({
      at: s.auditLog.at,
      entity: s.auditLog.entity,
      entityId: s.auditLog.entityId,
      action: s.auditLog.action,
      detail: s.auditLog.detail,
    })
    .from(s.auditLog)
    .where(
      and(
        eq(s.auditLog.projectId, p.id),
        gte(s.auditLog.at, new Date(`${from}T00:00:00Z`)),
        lte(s.auditLog.at, until),
        inArray(s.auditLog.entity, [
          "result",
          "evidence",
          "qpr",
          "report",
          "project",
        ]),
      ),
    );
  const quarterOf = (d: unknown) => (d as { quarter?: string } | null)?.quarter;
  const audit = log
    .filter(
      (l) =>
        ((l.entity === "result" || l.entity === "evidence") &&
          ids.includes(l.entityId)) ||
        (l.entity === "qpr" &&
          (report.kind !== "qpr" || quarterOf(l.detail) === report.quarter)) ||
        l.entity === "report" ||
        l.action === "stage_changed",
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((l) => {
      const by = (l.detail as { by?: string } | null)?.by ?? "";
      return {
        at: l.at.toISOString(),
        self: (l.detail as { selfApproved?: boolean } | null)?.selfApproved === true,
        what: l.action.replace(/_/g, " "),
        record:
          l.entity === "result" || l.entity === "evidence" ? l.entityId : "",
        by:
          kind === "donor"
            ? l.action.includes("accept") || l.action.includes("review")
              ? ROLE_FOR.accepted
              : "Roots of Peace staff"
            : by,
      };
    });

  // Finance's figures: always in the audit pack; in the donor pack when the donor's policy asks for full financials.
  const rules = await projectRules(code);
  const withMoney = kind === "audit" || rules.values.packFinancials === true;
  const a = await loadActuals(code);
  const money = withMoney
    ? a.imports.map((i) => ({
        file: i.file.name,
        sharepointUrl: i.file.sharepointUrl,
        by: kind === "donor" ? "Roots of Peace Finance" : personName(i.by),
        at: i.at,
        currency: i.currency,
        months: i.months,
        lines: i.lines.map((l) => ({
          code: l.code,
          description: l.description,
          budget: l.budget,
          actual: l.actual,
          months: l.months,
        })),
      }))
    : [];

  return {
    project: { code: p.code, name: p.name, donor: await donorNameOf(p) },
    report,
    label,
    kind,
    released: asOf ?? null,
    built: new Date().toISOString(),
    entries,
    audit,
    money,
    moneyHeld: !withMoney && a.imports.length > 0,
    /** Sign-offs in the period approved by the person who prepared them (solo mode). */
    selfApproved: await selfApprovedIn(code, from, to),
  };
}
export type PackIndex = Awaited<ReturnType<typeof packIndex>>;
