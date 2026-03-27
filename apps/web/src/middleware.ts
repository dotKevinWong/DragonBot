import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRateLimited } from "./lib/rate-limit";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function middleware(request: NextRequest) {
  // Use x-real-ip first (set by Vercel, not spoofable), fallback to x-forwarded-for
  const ip = request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";

  const path = request.nextUrl.pathname;

  // CSRF protection: verify Origin header on state-changing API requests
  if (path.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json(
            { error: "Cross-origin request blocked", code: "CSRF_REJECTED" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Invalid origin header", code: "CSRF_REJECTED" },
          { status: 403 },
        );
      }
    }
  }

  // Stricter rate limit for auth (10/min)
  if (path === "/api/auth" && request.method === "POST") {
    if (isRateLimited(`auth:${ip}`, 10, 60_000)) {
      return NextResponse.json(
        { error: "Too many requests. Try again later.", code: "RATE_LIMITED" },
        { status: 429 },
      );
    }
  }

  // General API rate limit (60/min per IP)
  if (path.startsWith("/api/")) {
    if (isRateLimited(`api:${ip}`, 60, 60_000)) {
      return NextResponse.json(
        { error: "Too many requests. Try again later.", code: "RATE_LIMITED" },
        { status: 429 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
