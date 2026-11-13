import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Live mode: keeps the Supabase sign-in cookie fresh and sends signed-out visitors to the
 * sign-in page. API routes check sign-in themselves and answer 401. Demo mode skips this.
 */
const OPEN = ["/", "/about", "/auth/callback", "/offline.html", "/sw.js", "/manifest.webmanifest"];

/**
 * A ceiling on changes per address per minute, against runaway scripts and loops. Kept in each
 * server instance's memory, so it is approximate; AI runs have their own limit in the database.
 */
const WRITES_PER_MINUTE = Number(process.env.WRITES_PER_MINUTE || 120);
const writes = new Map<string, { start: number; n: number }>();
function tooManyWrites(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const w = writes.get(ip);
  if (!w || now - w.start > 60_000) {
    writes.set(ip, { start: now, n: 1 });
    if (writes.size > 5000) writes.clear();
    return false;
  }
  w.n++;
  return w.n > WRITES_PER_MINUTE;
}

/**
 * One shared password for the whole site (SITE_PASSWORD), asked for by the browser's own prompt.
 * A gate against forwarded links, not a sign-in: it says nothing about who is visiting. Off when
 * unset. Kobo's webhook has its own login, and donor share links are read-only by design.
 */
const KOBO_HOOK = /^\/api\/projects\/[^/]+\/kobo\/hook$/;
function sitePasswordMissing(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const path = request.nextUrl.pathname;
  if (!password || KOBO_HOOK.test(path) || path.startsWith("/share/")) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return true;
  let given = "";
  try {
    given = atob(header.slice(6)).split(":").slice(1).join(":");
  } catch {
    return true;
  }
  // Compare every character so the time taken does not hint at how much was right.
  let diff = given.length ^ password.length;
  for (let i = 0; i < password.length; i++) diff |= password.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff !== 0;
}

export async function middleware(request: NextRequest) {
  if (sitePasswordMissing(request)) {
    return new NextResponse("This site needs the Roots of Peace site password.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Roots of Peace Workflow", charset="UTF-8"' } });
  }
  if (tooManyWrites(request)) return NextResponse.json({ error: "Too many changes in a minute. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": "60" } });
  if (process.env.DEMO_SIGN_IN === "1") return NextResponse.next();
  const path = request.nextUrl.pathname;
  const toSignIn = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  };
  // Not configured yet: nobody can sign in, so only the sign-in page (which explains why) opens.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return path.startsWith("/api/") || (OPEN.includes(path) || path.startsWith("/share/")) ? NextResponse.next() : toSignIn();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !path.startsWith("/api/") && !(OPEN.includes(path) || path.startsWith("/share/"))) return toSignIn();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
