import { describe, expect, it } from "vitest";
import type { Entry, HrState } from "@/lib/hr";
import { foldRecruitment, panelProblem, vacancyFilledBy } from "@/lib/recruitment";

/** MF-05 (D-16 to D-18): recruitment, kept light. */
const person = (id: string, grade?: number) => ({ id, current: { name: id, ...(grade !== undefined ? { grade } : {}) } });
const hr = { rules: { holders: { hr: ["sima"] } }, people: Object.fromEntries([person("sima", 6), person("karim", 8), person("nadia", 6), person("omar", 5), person("peter", 9)].map((p) => [p.id, p])), relations: [] } as unknown as HrState;
let n = 0;
const e = (actor: string, kind: string, data: object, at = "2026-12-20T09:00:00Z"): Entry => ({ n: ++n, at, actor, kind, subject: null, data, hash: "", prevHash: "" });
const OPEN = { title: "MEL Officer", grade: 5, office: "Afghanistan", opened: "2026-11-01", closes: "2026-11-15", panel: ["karim", "nadia", "omar"] };

describe("recruitment", () => {
  it("a panel of 3 or 4 at or above the post's grade, without HR", () => {
    expect(panelProblem(["karim", "nadia", "omar"], 5, hr)).toBeNull();
    expect(panelProblem(["karim", "nadia", "sima"], 5, hr)).toMatch(/HR runs the process and does not score/);
    expect(panelProblem(["karim", "nadia", "omar"], 6, hr)).toMatch(/omar is below the post's grade/);
    expect(panelProblem(["karim", "nadia"], 5, hr)).toMatch(/3 or 4 members/);
  });

  it("runs from a 14-day vacancy to a selection memo, with each rule held", () => {
    n = 0;
    const entries: Entry[] = [
      e("sima", "rec-open", { ...OPEN, closes: "2026-11-10" }, "2026-11-01T08:00:00Z"), // 9 days: refused
      e("sima", "rec-open", OPEN, "2026-11-01T08:00:00Z"), // n=2
      ...["A", "B", "C", "D"].map((x) => e("sima", "rec-candidate", { vacancy: 2, name: `Candidate ${x}`, related: "none", received: "2026-11-05" })), // n=3..6
      e("sima", "rec-grade", { vacancy: 2, candidate: 3, score: 4 }),
      e("sima", "rec-shortlist", { vacancy: 2, candidates: [3, 4, 5] }), // refused: not every CV graded
      e("sima", "rec-grade", { vacancy: 2, candidate: 4, score: 3 }),
      e("sima", "rec-grade", { vacancy: 2, candidate: 5, score: 4 }),
      e("sima", "rec-grade", { vacancy: 2, candidate: 6, score: 2 }),
      e("sima", "rec-shortlist", { vacancy: 2, candidates: [3, 4, 5] }),
      e("sima", "rec-score", { vacancy: 2, candidate: 3, score: 90 }), // HR does not score: refused
      ...["karim", "nadia", "omar"].flatMap((m) => [e(m, "rec-score", { vacancy: 2, candidate: 3, score: 70 }), e(m, "rec-score", { vacancy: 2, candidate: 4, score: 80 })]),
      e("sima", "rec-reference", { vacancy: 2, candidate: 5, from: "Former employer", summary: "Reliable and careful" }), // not interviewed by all: refused
      e("sima", "rec-reference", { vacancy: 2, candidate: 3, from: "Former employer", summary: "Reliable and careful" }),
      e("sima", "rec-select", { vacancy: 2, candidate: 3, memo: "Candidate A chosen for field experience in the project area." }), // not top, no reason: refused
      e("sima", "rec-select", { vacancy: 2, candidate: 3, memo: "Candidate A chosen for field experience in the project area.", deviation: "B scored higher but has no Dari; the post needs it." }),
    ];
    const { vacancies, ignored } = foldRecruitment(entries, hr);
    expect(vacancies).toHaveLength(1);
    expect(ignored.map((i) => i.why)).toEqual([
      "a vacancy is open at least 14 days",
      "every CV is graded first",
      "only the panel scores",
      "references come after the interviews, for finalists only",
      "the chosen candidate is not the top score: say why",
    ]);
    expect(foldRecruitment([e("sima", "rec-open", OPEN, "2026-11-20T08:00:00Z")], hr).ignored[0]?.why).toMatch(/advertised from the day it is opened here/);
    expect(vacancies[0].selected).toMatchObject({ candidate: 3, deviation: expect.stringMatching(/no Dari/) });
    // R2-23: the hire is matched to the vacancy by the chosen candidate's name.
    expect(vacancyFilledBy(vacancies, "candidate a")?.n).toBe(2);
    expect(vacancyFilledBy(vacancies, "Candidate B")).toBeNull();
  });
});
