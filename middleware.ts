import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const secureCookie = process.env.AUTH_URL?.startsWith("https:") ?? false;

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie,
  });

  const isAuthPage = request.nextUrl.pathname.startsWith("/login");
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth");

  if (isAuthApi) {
    return NextResponse.next();
  }

  if (!token && !isAuthPage) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (token && isAuthPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

// API routes handle auth themselves via `auth()` and often receive large
// bodies (e.g. cached chat messages). Excluding `/api/*` here avoids the
// middleware body-size cap (~50MB) and skips redundant auth work.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
