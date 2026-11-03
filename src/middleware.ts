import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Live mode: keeps the Supabase sign-in cookie fresh and sends signed-out visitors to the
 * sign-in page. API routes check sign-in themselves and answer 401. Demo mode skips this.
 */
const OPEN = ["/", "/about", "/auth/callback"];

export async function middleware(request: NextRequest) {
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
    return path.startsWith("/api/") || OPEN.includes(path) ? NextResponse.next() : toSignIn();
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

  if (!user && !path.startsWith("/api/") && !OPEN.includes(path)) return toSignIn();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
