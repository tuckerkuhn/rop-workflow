import { deflateSync } from "node:zlib";

/**
 * Proof files for the sample project (C5), made in code so nothing real is used: a drawn picture
 * of an apricot orchard (PNG) and one-page documents (PDF) that say they are samples.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type RGB = [number, number, number];

/**
 * A drawn orchard: sky, a hill, trees with fruit. `seed` moves the trees and the light, so each
 * picture differs (and so does its fingerprint). Not a photograph, and does not look like one.
 */
export function orchardPng(seed: number, w = 480, h = 360): Buffer {
  const rnd = (() => {
    let x = (seed * 2654435761) >>> 0 || 1;
    return () => ((x = (x * 1103515245 + 12345) >>> 0) / 2 ** 32);
  })();
  const px = new Uint8Array(w * h * 3);
  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    px.set(c, (y * w + x) * 3);
  };
  const horizon = Math.round(h * (0.45 + rnd() * 0.1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const hill = horizon - Math.round(18 * Math.sin((x / w) * Math.PI * (1 + seed % 3)));
      if (y < hill) set(x, y, [150 + Math.round((y / hill) * 60), 195 + Math.round((y / hill) * 30), 235]);
      else set(x, y, [96 - Math.round(((y - hill) / h) * 30), 140 - Math.round(((y - hill) / h) * 30), 70]);
    }
  const disc = (cx: number, cy: number, r: number, c: RGB) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(cx + x, cy + y, c);
  };
  const trees = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < trees; i++) {
    const cx = Math.round(((i + 0.5) / trees) * w + (rnd() - 0.5) * 30);
    const base = horizon + 40 + Math.round(rnd() * 60);
    const r = 34 + Math.round(rnd() * 14);
    for (let y = base - r; y < base + 6; y++) for (let x = cx - 5; x <= cx + 5; x++) set(x, y, [110, 78, 48]);
    disc(cx, base - r - 10, r, [58, 120, 52]);
    for (let f = 0; f < 9; f++) disc(cx + Math.round((rnd() - 0.5) * r * 1.4), base - r - 10 + Math.round((rnd() - 0.5) * r * 1.4), 5, [236, 150, 52]);
  }
  disc(Math.round(w * 0.82), Math.round(h * 0.16), 22, [250, 222, 120]);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** PDF text: printable ASCII only, with the three special characters escaped. */
const pdfText = (s: string) => s.replace(/[^\x20-\x7e]/g, "-").replace(/([\\()])/g, "\\$1");

/** A one-page PDF: a title, then lines of text, with "SAMPLE: fictional data" at the foot. */
export function samplePdf(title: string, lines: string[]): Buffer {
  const body = [
    "BT /F1 18 Tf 56 770 Td",
    `(${pdfText(title)}) Tj`,
    "/F1 11 Tf 0 -30 Td 15 TL",
    ...lines.map((l) => `(${pdfText(l)}) '`),
    "ET",
    "BT /F1 9 Tf 56 40 Td (SAMPLE: fictional data made by ROP Workflow, not a real record.) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
