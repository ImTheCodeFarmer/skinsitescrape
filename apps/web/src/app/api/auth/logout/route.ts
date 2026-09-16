import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, publicOrigin, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout?next=/ — clear the session. A POST so a stray link cannot sign someone out. */
export async function POST(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const res = NextResponse.redirect(new URL(next, publicOrigin(req)), { status: 303 });
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
