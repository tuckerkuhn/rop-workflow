import { NextResponse } from "next/server";
import { quarterOf } from "@/lib/results";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadCopies } from "@/server/qpr-store";
import { loadResults, loadUpdates } from "@/server/results-store";
import { loadShares } from "@/server/share-store";

/**
 * Getting started: the first steps for this person's role on this project, each ticked from what
 * they have actually done, so nobody ticks anything by hand.
 */

export type FirstStep = { key: string; text: string; href: string; done: boolean };

const prevQ = (q: string) => (q.endsWith("Q1") ? `${Number(q.slice(0, 4)) - 1}-Q4` : `${q.slice(0, 5)}Q${Number(q.slice(6)) - 1}`);

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const u = v.user;
    const me = u.id;
    const writer = !!u.admin || u.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r));
    const [results, updates] = await Promise.all([loadResults(code), loadUpdates(code)]);
    const steps: FirstStep[] = [{ key: "signin", text: "Sign in", href: "/home", done: true }];
    if (u.fieldAccess === "edit") {
      steps.push({ key: "result", text: "Record a result with its proof: a photo, attendance sheet or report", href: "/progress/results?record=1", done: results.some((r) => r.by === me) });
      steps.push({ key: "weekly", text: "Add an item, with a dated photo, to this week's weekly update", href: "/progress/weekly", done: updates.some((x) => x.by === me) });
    }
    if (u.project.includes("mel-owner")) steps.push({ key: "check", text: "Check a result someone else recorded: accept, query or reopen it", href: "/progress/results", done: results.some((r) => r.reviewedBy === me) });
    if (writer) {
      const q = quarterOf(new Date().toISOString().slice(0, 10));
      const copies = [...(await loadCopies(code, q)), ...(await loadCopies(code, prevQ(q)))];
      steps.push({ key: "practice", text: "Open the quarterly report and do a practice release", href: "/progress/report", done: copies.some((c) => c.by === me) });
      steps.push({ key: "share", text: "Share a report with the donor through a read-only link", href: "/progress/report", done: (await loadShares(code)).some((s) => s.by === me) });
    }
    return NextResponse.json({ steps });
  });
}
