import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin, safeNext, sessionCookie, steamProfile, verifySteamReturn } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Steam sends the browser here after sign-in. Verify the assertion, set the session, go back where the user was. */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const steamId = await verifySteamReturn(req.nextUrl.searchParams, origin);
  if (!steamId) {
    const back = new URL(next, origin);
    back.searchParams.set("login", "failed");
    return NextResponse.redirect(back, { status: 302 });
  }
  const profile = await steamProfile(steamId);
  const res = NextResponse.redirect(new URL(next, origin), { status: 302 });
  res.cookies.set(sessionCookie({ steamId, name: profile.name, avatar: profile.avatar, iat: Math.floor(Date.now() / 1000) }));
  return res;
}
