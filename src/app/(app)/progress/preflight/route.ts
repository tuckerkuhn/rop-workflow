import { NextResponse, type NextRequest } from "next/server";

/**
 * The report check now sits on each report. Old links land on the right report, at its check.
 * Answered by the server before any page is drawn: sent from inside a page, the same redirect
 * left the person on "Application error" (seen in round 4, for both old addresses).
 */
export function GET(req: NextRequest) {
  const report = req.nextUrl.searchParams.get("report");
  const p = req.nextUrl.searchParams.get("period") ?? "";
  const to =
    report === "annual"
      ? `/progress/annual${/^\d{4}$/.test(p) ? `?year=${p}` : ""}#checks`
      : report === "face"
        ? `/progress/face${/^\d{4}-\d{2}$/.test(p) ? `?month=${p}` : ""}#checks`
        : `/progress/report${/^\d{4}-Q[1-4]$/.test(p) ? `?q=${p}` : ""}#checks`;
  return NextResponse.redirect(new URL(to, req.url));
}
