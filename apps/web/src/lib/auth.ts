import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Sign in with Steam (OpenID 2.0) and a signed session cookie. Steam never
 * hands out a password or token: it bounces the browser back to us with a
 * claimed identity, which we verify with Steam before trusting it. The
 * session is the Steam id plus display name and avatar, HMAC-signed with
 * SESSION_SECRET so it cannot be forged; nothing is stored server-side.
 */
export type Session = { steamId: string; name: string; avatar: string | null; iat: number };

export const SESSION_COOKIE = "swt_session";
const MAX_AGE_S = 30 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // Derived fallback so a fresh deploy still works; set SESSION_SECRET to rotate sessions independently of the database.
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("SESSION_SECRET (or DATABASE_URL) must be set");
  return createHash("sha256").update(`swt-session:${base}`).digest("hex");
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(s: Session): string {
  const payload = b64(JSON.stringify(s));
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined | null): Session | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(sign(payload));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  try {
    const s = JSON.parse(unb64(payload)) as Session;
    if (typeof s.steamId !== "string" || !/^\d{17}$/.test(s.steamId)) return null;
    if (Date.now() / 1000 - s.iat > MAX_AGE_S) return null;
    return s;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export const sessionCookie = (s: Session) => ({
  name: SESSION_COOKIE,
  value: encodeSession(s),
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
});

/** Ranges beyond a week are for signed-in users. */
export const rangeNeedsSignIn = (range: number) => range > 7;

// ---------------------------------------------------------------- Steam OpenID

const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";

/** Where Steam should send the browser back. Prefers the configured public URL, else the proxied request's own host. */
export function publicOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Only same-site paths are honoured as a post-login destination. */
export const safeNext = (v: string | null | undefined) => (v && v.startsWith("/") && !v.startsWith("//") ? v : "/");

export function steamLoginUrl(origin: string, next: string): string {
  const returnTo = new URL("/api/auth/steam/return", origin);
  returnTo.searchParams.set("next", next);
  const p = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo.toString(),
    "openid.realm": origin,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${p}`;
}

/**
 * Ask Steam whether the assertion it just sent us is genuine
 * (openid.mode=check_authentication) and pull the 17-digit id out of the
 * claimed identity URL. Returns null on any doubt.
 */
export async function verifySteamReturn(query: URLSearchParams, expectedOrigin: string): Promise<string | null> {
  if (query.get("openid.mode") !== "id_res") return null;
  const claimed = query.get("openid.claimed_id") ?? "";
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
  if (!m) return null;
  const returnTo = query.get("openid.return_to") ?? "";
  if (!returnTo.startsWith(`${expectedOrigin}/api/auth/steam/return`)) return null;
  const body = new URLSearchParams();
  for (const [k, v] of query) if (k.startsWith("openid.")) body.set(k, v);
  body.set("openid.mode", "check_authentication");
  const res = await fetch(STEAM_OPENID, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  if (!res.ok) return null;
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text) ? m[1] : null;
}

/** Public profile name and avatar. Steam's XML profile endpoint needs no API key. */
export async function steamProfile(steamId: string): Promise<{ name: string; avatar: string | null }> {
  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`, { cache: "no-store", headers: { "User-Agent": "SkinWagerTracker" } });
    const xml = await res.text();
    const name = /<steamID><!\[CDATA\[([^\]]*)\]\]><\/steamID>/.exec(xml)?.[1] ?? /<steamID>([^<]*)<\/steamID>/.exec(xml)?.[1];
    const avatar = /<avatarFull><!\[CDATA\[([^\]]*)\]\]><\/avatarFull>/.exec(xml)?.[1] ?? /<avatarFull>([^<]*)<\/avatarFull>/.exec(xml)?.[1];
    return { name: name?.trim() || steamId, avatar: avatar?.trim() || null };
  } catch {
    return { name: steamId, avatar: null };
  }
}
