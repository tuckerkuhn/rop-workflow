import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { hrBook } from "@/server/hr-store";

/** Receipts and other evidence, kept by SHA-256 (migration 0018 refuses any other key, and any change). */

export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
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
