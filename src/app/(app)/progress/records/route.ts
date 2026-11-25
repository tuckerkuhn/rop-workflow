import { NextResponse, type NextRequest } from "next/server";

/**
 * The old all-in-one project record is gone: every part of it has its own page, listed on Projects.
 * Answered by the server before any page is drawn (see progress/preflight/route.ts).
 */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/project", req.url));
}
