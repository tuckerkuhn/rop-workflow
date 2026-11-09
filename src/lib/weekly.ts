import { z } from "zod";

/**
 * The weekly update the field team sends the donor: what happened this week, activity by
 * activity, with dated photos. Each item is an activity update (lib/results updateSchema), so
 * the same text and photos feed the quarterly report. A week is a reporting period with a number;
 * once marked sent it is locked, and a copy of what was sent is kept with it.
 */

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type WeekSent = { by: string; at: string; items: { id: string; activity: string; title?: string; note: string; photos: { hash: string; caption: string; taken?: string }[] }[] };
export type Week = { n: number; from: string; to: string; sent?: WeekSent };
export type WeeklyState = {
  /** The line under "Roots of Peace:", e.g. "Southern region (Kandahar and Helmand)". */
  region: string;
  weeks: Week[];
};
export const emptyWeekly: WeeklyState = { region: "", weeks: [] };

export const weeklyPatchSchema = z.discriminatedUnion("action", [
  /** Starts a week (or changes an unsent week's number and dates). */
  z.object({ action: z.literal("week"), n: z.number().int().min(1).max(9999), from: iso, to: iso, was: iso.optional() }),
  z.object({ action: z.literal("region"), region: z.string().trim().max(200) }),
  z.object({ action: z.literal("send"), from: iso }),
]);
export type WeeklyPatch = z.infer<typeof weeklyPatchSchema>;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const add = (iso: string, n: number) => fmt(new Date(day(iso).getTime() + n * 864e5));

/**
 * The working week a date falls in: Sunday to Thursday (Friday and Saturday are the weekend in
 * Afghanistan). A Friday or Saturday belongs to the week that has just ended.
 */
export function weekOf(date: string): { from: string; to: string } {
  const dow = day(date).getUTCDay(); // 0 Sunday … 6 Saturday
  const back = dow === 5 ? 5 : dow === 6 ? 6 : dow;
  const from = add(date, -back);
  return { from, to: add(from, 4) };
}

/** The sent week a date falls in, if any: updates dated in it can no longer be added, changed or removed. */
export const sentWeekFor = (s: WeeklyState, date: string) => s.weeks.find((w) => w.sent && date >= w.from && date <= w.to) ?? null;

/** Whether two periods overlap. */
export const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from <= b.to && b.from <= a.to;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "10–15 October 2026", "27 September – 1 October 2026". */
export function periodLabel(from: string, to: string): string {
  const [fy, fm, fd] = [from.slice(0, 4), Number(from.slice(5, 7)), Number(from.slice(8, 10))];
  const [ty, tm, td] = [to.slice(0, 4), Number(to.slice(5, 7)), Number(to.slice(8, 10))];
  if (fy !== ty) return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fm !== tm) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
}
export const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * The date a photo was taken, from its EXIF data (DateTimeOriginal, else DateTime), or null.
 * Read before the photo is shrunk for upload, which drops the EXIF data.
 */
export function exifDate(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    const marker = v.getUint16(o);
    const size = v.getUint16(o + 2);
    if (marker === 0xffe1 && o + 10 <= v.byteLength && v.getUint32(o + 4) === 0x45786966) return tiffDate(v, o + 10);
    if ((marker & 0xff00) !== 0xff00 || size < 2) return null;
    o += 2 + size;
  }
  return null;
}

function tiffDate(v: DataView, start: number): string | null {
  if (start + 8 > v.byteLength) return null;
  const le = v.getUint16(start) === 0x4949;
  const u16 = (p: number) => v.getUint16(p, le);
  const u32 = (p: number) => v.getUint32(p, le);
  const read = (ifd: number, want: number[]): Record<number, number> => {
    const out: Record<number, number> = {};
    if (ifd + 2 > v.byteLength) return out;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      const tag = u16(e);
      if (want.includes(tag)) out[tag] = u32(e + 8);
    }
    return out;
  };
  const text = (off: number) => {
    const p = start + off;
    if (p + 19 > v.byteLength) return null;
    let s = "";
    for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(p + i));
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return m && m[1] !== "0000" ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  const ifd0 = read(start + u32(start + 4), [0x0132, 0x8769]);
  if (ifd0[0x8769]) {
    const exif = read(start + ifd0[0x8769], [0x9003]);
    if (exif[0x9003]) {
      const d = text(exif[0x9003]);
      if (d) return d;
    }
  }
  return ifd0[0x0132] ? text(ifd0[0x0132]) : null;
}
