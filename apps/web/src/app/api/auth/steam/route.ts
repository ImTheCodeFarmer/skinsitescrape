import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin, safeNext, steamLoginUrl } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/steam?next=/casino/x?range=30 — bounce to Steam's sign-in page. */
export function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(steamLoginUrl(publicOrigin(req), next), { status: 302 });
}
