/**
 * Farmer training details (MF-09): which curriculum and version a session taught, and each
 * farmer's pre and post test scores. The curriculum is a project setting (Set up, the input
 * package); the scores are typed on the training form, one line per farmer ticked, and kept on each
 * farmer's record when the session is accepted. Written as text the form saves:
 * "F-1001:4:8, F-1002::9" (no pre-test for F-1002). Staff training is lib/training, not this.
 */

export type Curriculum = { name: string; version: string };
export const curriculumText = (c: Curriculum | null | undefined) => (c?.name ? `${c.name}${c.version ? `, version ${c.version}` : ""}` : "");

export type Score = { farmer: string; pre?: number; post?: number };
/** One training session a farmer attended, as their record keeps it. */
export type FarmerTraining = { date: string; session: string; curriculum?: string; pre?: number; post?: number; outOf?: number; ref: string };

const SCORE = /^\d{1,4}(\.\d{1,2})?$/;

/**
 * Reads the scores, or says what is wrong. Every farmer named must be ticked as attending, and no
 * score may be above the mark the test is out of.
 */
export function parseScores(text: string, ticked: string[], outOf?: number): { scores: Score[]; problem?: string } {
  const scores: Score[] = [];
  for (const part of text.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [farmer, pre = "", post = ""] = part.split(":").map((x) => x.trim());
    if (!ticked.includes(farmer)) return { scores: [], problem: `${farmer} has scores but is not ticked as attending.` };
    for (const v of [pre, post]) {
      if (v && !SCORE.test(v)) return { scores: [], problem: `${farmer}: "${v}" is not a score.` };
      if (v && outOf !== undefined && Number(v) > outOf) return { scores: [], problem: `${farmer}: ${v} is more than the ${outOf} the test is marked out of.` };
    }
    if (scores.some((s) => s.farmer === farmer)) return { scores: [], problem: `${farmer} has scores twice.` };
    if (pre || post) scores.push({ farmer, ...(pre ? { pre: Number(pre) } : {}), ...(post ? { post: Number(post) } : {}) });
  }
  return { scores };
}

export const scoresText = (scores: Score[]) => scores.map((s) => `${s.farmer}:${s.pre ?? ""}:${s.post ?? ""}`).join(", ");

/** "pre-test 4/10, post-test 8/10" for a farmer's history line; empty with no scores. */
export function scoreLine(s: Pick<Score, "pre" | "post">, outOf?: number): string {
  const of = outOf !== undefined ? `/${outOf}` : "";
  return [s.pre !== undefined ? `pre-test ${s.pre}${of}` : "", s.post !== undefined ? `post-test ${s.post}${of}` : ""].filter(Boolean).join(", ");
}
