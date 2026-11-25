/**
 * A tiny JPEG that holds only EXIF data, as a phone camera writes it: the day and time taken and,
 * when `gps` is given, where. For tests of lib/exif and of everything that reads a photo's own facts.
 * Not a viewable picture: the readers look at the header only.
 */
export function exifJpeg(o: { taken?: string; gps?: { lat: number; lon: number } | null; littleEndian?: boolean } = {}): Uint8Array {
  const le = o.littleEndian ?? true;
  const taken = o.taken ?? "2026:11:19 10:42:07";
  const tiff = new Uint8Array(400);
  const v = new DataView(tiff.buffer);
  const u16 = (p: number, n: number) => v.setUint16(p, n, le);
  const u32 = (p: number, n: number) => v.setUint32(p, n, le);
  const text = (p: number, t: string) => [...t].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  const entry = (p: number, tag: number, type: number, count: number, value: number) => {
    u16(p, tag);
    u16(p + 2, type);
    u32(p + 4, count);
    u32(p + 8, value);
  };
  u16(0, le ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, 8);
  // IFD0 at 8: pointers to the Exif and GPS directories.
  const gps = o.gps ?? null;
  u16(8, gps ? 2 : 1);
  entry(10, 0x8769, 4, 1, 60);
  if (gps) entry(22, 0x8825, 4, 1, 120);
  // Exif directory at 60: DateTimeOriginal, 20 characters at 90.
  u16(60, 1);
  entry(62, 0x9003, 2, 20, 90);
  text(90, taken);
  if (gps) {
    // GPS directory at 120: N/S, latitude, E/W, longitude. Rationals at 200 and 230.
    u16(120, 4);
    const ref = (p: number, tag: number, c: string) => {
      entry(p, tag, 2, 2, 0);
      // A short text value sits in the entry itself, at its first byte whatever the byte order.
      v.setUint8(p + 8, c.charCodeAt(0));
    };
    ref(122, 1, gps.lat < 0 ? "S" : "N");
    entry(134, 2, 5, 3, 200);
    ref(146, 3, gps.lon < 0 ? "W" : "E");
    entry(158, 4, 5, 3, 230);
    const dms = (p: number, deg: number) => {
      const a = Math.abs(deg);
      const d = Math.floor(a);
      const m = Math.floor((a - d) * 60);
      const s = Math.round(((a - d) * 60 - m) * 60 * 10000);
      u32(p, d);
      u32(p + 4, 1);
      u32(p + 8, m);
      u32(p + 12, 1);
      u32(p + 16, s);
      u32(p + 20, 10000);
    };
    dms(200, gps.lat);
    dms(230, gps.lon);
  }
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  new DataView(head.buffer).setUint16(4, tiff.length + 8);
  const out = new Uint8Array(head.length + tiff.length + 2);
  out.set(head, 0);
  out.set(tiff, head.length);
  out.set([0xff, 0xd9], head.length + tiff.length);
  return out;
}
