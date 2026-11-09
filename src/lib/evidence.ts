/**
 * Number to proof. Every reported figure has a path to the accepted results behind it and their
 * proof: on screen, one tap opens them (components/progress/proof-panel); in Word and Excel, each
 * figure carries a short reference, e.g. [E-07], that names its entry in the evidence pack.
 *
 * References are worked out from the report's own rows, in table order, so the Word file and the
 * pack built from the same report always agree. A figure with no accepted result behind it has
 * no reference: it shows "No proof yet".
 *
 * Two packs (decided 9 Nov 2026):
 *  - the donor pack: photos only where the photo library's consent rules allow donor use;
 *    documents (attendance sheets, signature lists, ID copies) listed, held by ROP for
 *    verification; people shown by role; Finance's workbook only when the donor's policy asks
 *    for full financials;
 *  - the audit pack: everything, with names, Finance's workbook included. Administrators and the
 *    MEL owner only; every download is in the audit log.
 */

export type ProofFile = {
  hash: string;
  name: string;
  type: string;
  caption: string;
};
export type ProofResult = {
  id: string;
  indicator: string;
  date: string;
  value: number;
  unit: string;
  province: string;
  district: string;
  note: string;
  recordedBy: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  files: ProofFile[];
  links: { url: string; title: string }[];
  kobo: { asset: string; id?: number } | null;
  noFile: string | null;
};

/** A figure: an indicator's value over a period, made of accepted results. */
export type Figure = {
  ref: string | null;
  indicator: string;
  donorCode: string;
  name: string;
  unit: string;
  label: string;
  /** Null: since the start (cumulative). */ from: string | null;
  to: string;
  value: number;
};

export const ref = (k: number) => `E-${String(k).padStart(2, "0")}`;

/** The quarterly report's figures: each indicator's quarter, then its year to date, where results stand behind them. */
export function qprFigures(
  rows: {
    code: string;
    donorCode: string;
    name: string;
    unit: string;
    quarter: number;
    year: number;
    records: { quarter: number; year: number };
  }[],
  quarter: string,
  from: string,
  to: string,
): Figure[] {
  const yearFrom = `${quarter.slice(0, 4)}-01-01`;
  let k = 0;
  return rows.flatMap((r) => [
    {
      ref: r.records.quarter ? ref(++k) : null,
      indicator: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      label: `${quarter.replace("-", " ")}`,
      from,
      to,
      value: r.quarter,
    },
    {
      ref: r.records.year ? ref(++k) : null,
      indicator: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      label: `${quarter.slice(0, 4)} to date`,
      from: yearFrom,
      to,
      value: r.year,
    },
  ]);
}

/** The annual or final report's figures: achieved in the period, then cumulative since the start. */
export function periodFigures(
  rows: {
    code: string;
    donorCode: string;
    name: string;
    unit: string;
    achieved: number;
    cumulative: number;
  }[],
  from: string,
  to: string,
  label: string,
  counted: (code: string, from: string | null, to: string) => number,
): Figure[] {
  let k = 0;
  return rows.flatMap((r) => [
    {
      ref: counted(r.code, from, to) ? ref(++k) : null,
      indicator: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      label,
      from,
      to,
      value: r.achieved,
    },
    {
      ref: counted(r.code, null, to) ? ref(++k) : null,
      indicator: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      label: "Cumulative",
      from: null,
      to,
      value: r.cumulative,
    },
  ]);
}

/** The reference of an indicator's figure: "q" the quarter (or the period), "y" the year to date (or cumulative). */
export const refOf = (figs: Figure[], indicator: string, which: "q" | "y") =>
  figs.filter((f) => f.indicator === indicator)[which === "q" ? 0 : 1]?.ref ??
  null;

/** In Word and Excel: the figure with its reference, or marked when nothing stands behind it. */
export const withRef = (text: string, r: string | null, value: number) =>
  r ? `${text} [${r}]` : value ? `${text} [no proof yet]` : text;

/** Documents rather than photos: kept by ROP in the donor pack, listed for verification. */
export const isPhotoFile = (f: { type: string }) =>
  /^image\/(jpeg|png|webp)$/.test(f.type);

/** How a person appears to a donor: their role, never their name. */
export const ROLE_FOR = { recorded: "Field team", accepted: "MEL" } as const;
