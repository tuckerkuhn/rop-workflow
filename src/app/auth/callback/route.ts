import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/server/auth";

/**
 * Where the emailed sign-in link lands. Supabase's default email (used until custom SMTP is set
 * up) sends a link instead of a code, so this finishes sign-in from the link. The code entry on
 * the sign-in page keeps working once the email template shows {{ .Token }}.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await supabaseServer();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" | "magiclink" })).error;
  }

  const to = url.clone();
  to.search = "";
  to.pathname = ok ? "/home" : "/";
  if (!ok) to.searchParams.set("signin", "link-expired");
  return NextResponse.redirect(to);
}
