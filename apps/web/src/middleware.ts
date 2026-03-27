import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isRateLimited } from "./lib/rate-limit";

export function middleware(request: NextRequest) {
  const ip = request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";

  const path = request.nextUrl.pathname;

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
