import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "budget_session";
const MAX_AGE = 400 * 24 * 3600;
const PUBLIC = ["/login", "/setup", "/api/ingest", "/api/inbound", "/manifest.webmanifest", "/sw.js", "/icon", "/apple-icon", "/pwa-icon"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE)?.value;
  if (!token && !PUBLIC.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const res = NextResponse.next();
  // Session glissante : on repousse l'expiration du cookie à chaque visite
  if (token && !pathname.startsWith("/api/")) {
    res.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
