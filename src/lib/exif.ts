/**
 * What a photo says about itself: the day and time it was taken and where, read from the EXIF data
 * a phone camera writes into a JPEG. Nobody types a date or coordinates the photo already holds.
 *
 * Read from the original file. Shrinking a photo for upload (a canvas redraw) drops this data, so
 * the screens read it first. A phone, a messaging app or a photo picker may also have removed the
 * location before the file reaches us: every caller needs a fallback (the form's own GPS point,
 * then the device's location) and must not treat a photo without a location as a fault.
 *
 * Pure and dependency-free: runs in the browser and on the server.
 */

export type PhotoFacts = {
  /** The day it was taken, YYYY-MM-DD (DateTimeOriginal, else DateTime). */
  date: string | null;
  /** The time it was taken on the phone's clock, HH:MM. No time zone: EXIF rarely holds one. */
  time: string | null;
  /** Where it was taken, in decimal degrees. */
  gps: { lat: number; lon: number } | null;
};

const NONE: PhotoFacts = { date: null, time: null, gps: null };

export function photoFacts(buf: ArrayBuffer | Uint8Array): PhotoFacts {
  const v = buf instanceof Uint8Array ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return NONE;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    const marker = v.getUint16(o);
    const size = v.getUint16(o + 2);
    // APP1 holding "Exif\0\0": the TIFF block starts 10 bytes in.
    if (marker === 0xffe1 && o + 10 <= v.byteLength && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10);
    if ((marker & 0xff00) !== 0xff00 || size < 2) return NONE;
    o += 2 + size;
  }
  return NONE;
}

type Entry = { type: number; count: number; at: number };

function tiff(v: DataView, start: number): PhotoFacts {
  if (start + 8 > v.byteLength) return NONE;
  const le = v.getUint16(start) === 0x4949;
  const u16 = (p: number) => v.getUint16(p, le);
  const u32 = (p: number) => v.getUint32(p, le);
  /** The entries of one directory, by tag. `at` is where the 4-byte value (or its offset) sits. */
  const dir = (off: number): Map<number, Entry> => {
    const out = new Map<number, Entry>();
    const p = start + off;
    if (off <= 0 || p + 2 > v.byteLength) return out;
    const n = u16(p);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return out;
  };
  const ascii = (e: Entry | undefined, max: number) => {
    if (!e || e.type !== 2) return "";
    const n = Math.min(e.count, max);
    const p = n <= 4 ? e.at : start + u32(e.at);
    if (p + n > v.byteLength) return "";
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = v.getUint8(p + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  /** Three rationals (degrees, minutes, seconds) as decimal degrees. */
  const degrees = (e: Entry | undefined) => {
    if (!e || e.type !== 5 || e.count < 3) return null;
    const p = start + u32(e.at);
    if (p + 24 > v.byteLength) return null;
    let out = 0;
    for (let i = 0; i < 3; i++) {
      const den = u32(p + i * 8 + 4);
      if (!den) return null;
      out += u32(p + i * 8) / den / 60 ** i;
    }
    return out;
  };
  const when = (e: Entry | undefined) => {
    const m = ascii(e, 19).match(/^(\d{4}):(\d{2}):(\d{2})(?: (\d{2}):(\d{2}))?/);
    return m && m[1] !== "0000" ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null } : null;
  };

  const ifd0 = dir(u32(start + 4));
  const sub = ifd0.get(0x8769);
  const taken = (sub ? when(dir(u32(sub.at)).get(0x9003)) : null) ?? when(ifd0.get(0x0132));

  let gps: PhotoFacts["gps"] = null;
  const g = ifd0.get(0x8825);
  if (g) {
    const d = dir(u32(g.at));
    const lat = degrees(d.get(2));
    const lon = degrees(d.get(4));
    if (lat !== null && lon !== null) {
      const south = ascii(d.get(1), 2).toUpperCase().startsWith("S");
      const west = ascii(d.get(3), 2).toUpperCase().startsWith("W");
      const at = { lat: south ? -lat : lat, lon: west ? -lon : lon };
      // 0, 0 is what a camera writes when it had no fix: not a place.
      if (Math.abs(at.lat) <= 90 && Math.abs(at.lon) <= 180 && !(at.lat === 0 && at.lon === 0)) gps = { lat: round(at.lat), lon: round(at.lon) };
    }
  }
  return { date: taken?.date ?? null, time: taken?.time ?? null, gps };
}

/** Six decimal places: about ten centimetres, more than any phone gives. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/* ---------- places ---------- */

export type Point = { lat: number; lon: number };

/** A point from loose input, or null when it is not a place on earth (or is the 0, 0 of "no fix"). */
export function pointOf(lat: unknown, lon: unknown): Point | null {
  const a = typeof lat === "string" && lat.trim() ? Number(lat) : lat;
  const b = typeof lon === "string" && lon.trim() ? Number(lon) : lon;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: round(a), lon: round(b) };
}

/** Metres between two points (haversine), rounded. */
export function metresBetween(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** "35 m", "1.2 km": a distance in words. */
export const distanceText = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/** A small OpenStreetMap view with a pin, for an iframe. Loaded only when a person asks for the map. */
export function mapEmbed(p: Point, span = 0.004): string {
  const box = [p.lon - span, p.lat - span, p.lon + span, p.lat + span].map((n) => n.toFixed(5)).join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${p.lat.toFixed(5)}%2C${p.lon.toFixed(5)}`;
}
