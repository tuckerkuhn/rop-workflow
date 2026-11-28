import type { AgeBand, Gender } from "@/lib/field";
import { parseHousehold, type HouseholdMember } from "@/lib/household";
import { splitNames } from "@/lib/eligibility";

/**
 * Reading a farmer list (CSV, as saved from Excel) into Field activities. One row per farmer:
 * ID, village, sex and hectares are required; name, age band, household size, contribution paid and
 * starting step are optional. Names go to the protected names table only (server/farmers), never
 * into field records, Kobo or email.
 */

export type FarmerRow = {
  id: string;
  village: string;
  gender: Gender;
  hectares: number;
  name?: string;
  /** Personal data, kept with the name (server/farmers): used to find a farmer registered twice. */
  phone?: string;
  ageBand?: AgeBand;
  householdSize?: number;
  /** Who lives in the household by sex and age, as "Female 34, Male 12" (MF-07). */
  household?: HouseholdMember[];
  /** What the farmer grows now, as "wheat, maize". */
  crops?: string[];
  /** The package the farmer chose, by its short id or its name (checked against the project's packages when loaded). */
  package?: string;
  contributionPaid?: boolean;
  step?: StartStep;
};

/** Where a farmer can start: a project loading farmers mid-season starts them where they are. */
export const START_STEPS = ["train", "prepare", "verify", "distribute"] as const;
export type StartStep = (typeof START_STEPS)[number];

const HEADERS: Record<keyof FarmerRow, string[]> = {
  id: ["id", "farmer id", "farmer_id", "code", "farmer code"],
  village: ["village", "community", "location"],
  gender: ["sex", "gender"],
  hectares: ["hectares", "ha", "area", "area (ha)", "plot size", "plot (ha)"],
  name: ["name", "full name", "farmer name"],
  phone: ["phone", "phone number", "mobile", "telephone"],
  ageBand: ["age", "age band", "age group"],
  householdSize: ["household", "household size", "hh size"],
  household: ["household members", "members", "roster"],
  crops: ["crops", "crops grown", "grows"],
  package: ["package", "package chosen"],
  contributionPaid: ["contribution", "contribution paid"],
  step: ["step", "start step", "stage"],
};

/** Splits CSV text into rows, honouring quotes ("a, b" and "" inside quotes). */
export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  // One separator per file, from the first line: Excel saves with ; or tabs in some languages.
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

const gender = (v: string): Gender | null => {
  const x = v.trim().toLowerCase();
  if (["f", "female", "woman", "w"].includes(x)) return "Female";
  if (["m", "male", "man"].includes(x)) return "Male";
  return null;
};
const ageBand = (v: string): AgeBand | null => {
  const x = v.trim();
  if (!x) return null;
  if (/^18/.test(x) || /youth/i.test(x)) return "18–35 (youth)";
  if (/^36/.test(x)) return "36–49";
  if (/^50/.test(x)) return "50+";
  const n = Number(x);
  if (!Number.isFinite(n) || n < 10 || n > 120) return null;
  return n <= 35 ? "18–35 (youth)" : n < 50 ? "36–49" : "50+";
};
const yes = (v: string) => ["yes", "y", "true", "1", "paid"].includes(v.trim().toLowerCase());

export const FARMER_ID = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * The farmers in a CSV, with every problem by row number (as Excel shows it). Rows with a problem
 * are left out; the caller shows the problems before anything is saved.
 */
export function parseFarmers(text: string): { rows: FarmerRow[]; problems: string[]; hasNames: boolean } {
  const all = csvRows(text);
  if (!all.length) return { rows: [], problems: ["The file is empty."], hasNames: false };
  const head = all[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries((Object.keys(HEADERS) as (keyof FarmerRow)[]).map((k) => [k, head.findIndex((h) => HEADERS[k].includes(h))])) as Record<keyof FarmerRow, number>;
  const missing = (["id", "village", "gender", "hectares"] as const).filter((k) => col[k] < 0);
  if (missing.length) return { rows: [], problems: [`The first row must name the columns. Missing: ${missing.map((k) => HEADERS[k][0]).join(", ")}.`], hasNames: false };
  const rows: FarmerRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  all.slice(1).forEach((r, k) => {
    const n = k + 2;
    const get = (c: keyof FarmerRow) => (col[c] >= 0 ? (r[col[c]] ?? "").trim() : "");
    const id = get("id");
    const g = gender(get("gender"));
    const ha = Number(get("hectares").replace(",", "."));
    const bad: string[] = [];
    if (!FARMER_ID.test(id)) bad.push("the ID can use letters, digits, . _ and - only");
    else if (seen.has(id.toUpperCase())) bad.push(`${id} appears twice`);
    if (!get("village")) bad.push("no village");
    if (!g) bad.push(`sex "${get("gender")}" is not F or M`);
    if (!Number.isFinite(ha) || ha < 0 || ha > 10000) bad.push(`hectares "${get("hectares")}" is not a number`);
    const step = get("step").toLowerCase();
    if (step && !(START_STEPS as readonly string[]).includes(step)) bad.push(`step "${get("step")}" is not one of ${START_STEPS.join(", ")}`);
    const hh = get("householdSize");
    if (hh && !(Number.isInteger(Number(hh)) && Number(hh) >= 0 && Number(hh) <= 100)) bad.push(`household size "${hh}" is not a whole number`);
    if (get("phone") && !get("name")) bad.push("a phone number is kept with the farmer's name: add the name or leave the phone out");
    else if (get("phone") && !/^\+?[\d\s().-]{7,20}$/.test(get("phone"))) bad.push(`phone "${get("phone")}" is not a phone number`);
    const roster = parseHousehold(get("household"));
    if (roster.problem) bad.push(`household members: ${roster.problem.replace(/\.$/, "")}`);
    else if (hh && roster.members.length && roster.members.length !== Number(hh)) bad.push(`household size ${hh} but ${roster.members.length} household members listed`);
    if (bad.length) {
      problems.push(`Row ${n}: ${bad.join("; ")}.`);
      return;
    }
    seen.add(id.toUpperCase());
    rows.push({
      id,
      village: get("village"),
      gender: g!,
      hectares: Math.round(ha * 1000) / 1000,
      ...(get("name") ? { name: get("name") } : {}),
      ...(get("phone") ? { phone: get("phone") } : {}),
      ...(ageBand(get("ageBand")) ? { ageBand: ageBand(get("ageBand"))! } : {}),
      ...(hh ? { householdSize: Number(hh) } : {}),
      ...(roster.members.length ? { household: roster.members, householdSize: roster.members.length } : {}),
      ...(get("package") ? { package: get("package") } : {}),
      ...(splitNames(get("crops")).length ? { crops: splitNames(get("crops")).slice(0, 20) } : {}),
      ...(get("contributionPaid") ? { contributionPaid: yes(get("contributionPaid")) } : {}),
      ...(step ? { step: step as StartStep } : {}),
    });
  });
  return { rows, problems, hasNames: rows.some((r) => !!r.name) };
}

/** A blank list to fill in, with the columns in the order the reader expects. */
export const FARMER_TEMPLATE = "Farmer ID,Village,Sex,Hectares,Name,Phone,Age band,Household size,Household members,Contribution paid,Step\nF-1001,Example village,F,0.5,,,36–49,3,\"Female 34, Male 40, Female 6\",yes,train\n";
