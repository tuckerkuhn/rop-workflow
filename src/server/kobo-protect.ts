import { createHmac } from "node:crypto";

/**
 * Data protection for Kobo answers (data protection review, November 2026): answers to questions
 * that hold a person's identity (names, phone numbers, ID numbers) are not stored as given. When an
 * indicator counts the question (e.g. distinct farmers by name), the answer becomes a keyed
 * fingerprint, so counting still works but the name is not kept; otherwise it is left out. The
 * submission notes which answers were removed. Farmers' real names belong in the protected
 * participants table, shown only to people with the names permission.
 */

const PERSONAL = /(^|_)(name|names|fullname|firstname|lastname|surname|father|husband|phone|phonenumber|mobile|tel|telephone|whatsapp|contact|tazkira|tazkera|nid|nationalid|idcard|idnumber|cnic|passport)($|_)/i;
const NOT_A_PERSON = /crop|variety|product|business|company|enterprise|group|cooperative|coop|village|district|province|activity|form|item|market|buyer|supplier|shop|org/i;

/** Whether a question's answer identifies a person, judged from its name (the last part of its path). */
export function isPersonalQuestion(path: string) {
  const last = path.split("/").at(-1)!.replace(/[^a-z0-9_]/gi, "").toLowerCase();
  const squashed = last.replace(/_/g, "");
  return !NOT_A_PERSON.test(last) && (PERSONAL.test(last) || PERSONAL.test(squashed));
}

const fingerprint = (projectId: string, value: string) => `pseudonym:${createHmac("sha256", process.env.KOBO_TOKEN_KEY || `rop-${projectId}`).update(`${projectId}:${value.trim().toLowerCase()}`).digest("hex").slice(0, 16)}`;

/** The submission as stored: personal answers fingerprinted (when counted) or left out. */
export function protectSubmission<T extends Record<string, unknown>>(x: T, projectId: string, counted: Set<string>): T {
  const removed: string[] = [];
  const walk = (o: Record<string, unknown>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const path = prefix ? `${prefix}/${k}` : k;
      if (k.startsWith("_")) {
        out[k] = v;
        continue;
      }
      if (Array.isArray(v)) out[k] = v.map((item) => (item && typeof item === "object" && !Array.isArray(item) ? walk(item as Record<string, unknown>, path) : item));
      else if (v !== null && v !== undefined && v !== "" && typeof v !== "object" && isPersonalQuestion(k)) {
        const full = [...counted].find((q) => q === k || q === path || q.endsWith(`/${k}`));
        if (full) out[k] = fingerprint(projectId, String(v));
        else removed.push(path);
      } else out[k] = v;
    }
    return out;
  };
  const kept = walk(x, "") as T;
  return removed.length ? ({ ...kept, _personal_removed: removed } as T) : kept;
}
