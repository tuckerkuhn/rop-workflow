import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { hrBook } from "@/server/hr-store";

/** Receipts and other evidence, kept by SHA-256 (migration 0018 refuses any other key, and any change). */

export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
/** A Word file: accepted only where a document is asked for (a funding call), never as a receipt. */
export const WORD_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** An Excel file: the same, for a call's budget template or eligibility checklist. */
export const EXCEL_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** A document's type, from its name when the browser did not say (it often does not for Word or Excel). */
export function documentType(name: string, type: string): string {
  if (type && type !== "application/octet-stream") return type;
  const n = name.toLowerCase();
  return n.endsWith(".pdf") ? "application/pdf" : n.endsWith(".docx") ? WORD_TYPE : n.endsWith(".xlsx") ? EXCEL_TYPE : type;
}
/** Vercel takes request bodies up to 4.5 MB; photos are shrunk in the browser well below this. */
export const MAX_FILE = 4_000_000;

export async function saveFile(buf: Buffer, name: string, type: string, by: string) {
  const hash = createHash("sha256").update(buf).digest("hex");
  await db.insert(s.hrFiles).values({ hash, book: hrBook(), name: name.slice(0, 200), type, size: buf.length, data: buf, uploadedBy: by }).onConflictDoNothing();
  return { hash, name: name.slice(0, 200), type, size: buf.length };
}

export async function loadFile(hash: string) {
  const [f] = await db.select().from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), eq(s.hrFiles.hash, hash))).limit(1);
  return f ?? null;
}
