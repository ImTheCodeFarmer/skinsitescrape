import "server-only";

/**
 * The contact form. A submission is checked three ways before it reaches
 * Telegram: a Cloudflare Turnstile token verified with Cloudflare, a
 * honeypot field only bots fill in, and a per-IP rate limit. It is then
 * sent to one Telegram chat by the bot in CONTACT_TELEGRAM_BOT_TOKEN
 * (separate from the users' alert bots in lib/alerts.ts).
 */
export type ContactInput = { name: string; email: string; telegram: string; discord: string; message: string; website: string; token: string };
export type ContactField = "name" | "email" | "telegram" | "discord" | "message";
export type ContactResult = { ok: true } | { ok: false; error: string; field?: ContactField };

const LIMITS = { name: 80, email: 254, telegram: 33, discord: 40, message: 3000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEGRAM_RE = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;
const DISCORD_RE = /^[^\s@#:`]{2,32}(#\d{4})?$/;

/** Field checks, shared shape with the form so it can point at the field. Returns the cleaned values. */
export function validateContact(i: ContactInput): { ok: true; value: Omit<ContactInput, "website" | "token"> } | { ok: false; error: string; field: ContactField } {
  const v = { name: i.name.trim(), email: i.email.trim(), telegram: i.telegram.trim(), discord: i.discord.trim(), message: i.message.trim() };
  if (!v.name) return { ok: false, field: "name", error: "Tell us your name." };
  if (v.name.length > LIMITS.name) return { ok: false, field: "name", error: "That name is too long." };
  if (!EMAIL_RE.test(v.email) || v.email.length > LIMITS.email) return { ok: false, field: "email", error: "Enter a valid email address." };
  if (v.telegram && !TELEGRAM_RE.test(v.telegram)) return { ok: false, field: "telegram", error: "Telegram usernames are 5–32 letters, digits or underscores." };
  if (v.discord && !DISCORD_RE.test(v.discord)) return { ok: false, field: "discord", error: "Enter a Discord username." };
  if (v.message.length < 10) return { ok: false, field: "message", error: "Write a little more so we can help." };
  if (v.message.length > LIMITS.message) return { ok: false, field: "message", error: `Keep the message under ${LIMITS.message.toLocaleString("en-US")} characters.` };
  if (v.telegram && !v.telegram.startsWith("@")) v.telegram = `@${v.telegram}`;
  return { ok: true, value: v };
}

// ---------------------------------------------------------------- rate limit
/**
 * At most MAX submissions per IP per WINDOW. In memory, so per server
 * process and reset on deploy; enough for one instance, and Turnstile is
 * the main gate anyway. Only well-formed submissions count, so a typo
 * does not use up a visitor's tries; a failed Turnstile check does count.
 */
const WINDOW_MS = 15 * 60_000;
const MAX = 3;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, ts] of hits) if (ts.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return recent.length > MAX;
}

// ---------------------------------------------------------------- turnstile
/** Verify a Turnstile token with Cloudflare. Without TURNSTILE_SECRET_KEY the check is skipped in development and fails in production. */
async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[contact] TURNSTILE_SECRET_KEY is not set; rejecting submissions");
      return false;
    }
    return true;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const r = (await res.json()) as { success: boolean; action?: string; "error-codes"?: string[] };
    if (!r.success) console.warn("[contact] turnstile rejected", r["error-codes"]);
    return r.success && (!r.action || r.action === "contact");
  } catch (e) {
    console.error("[contact] turnstile verify failed", e);
    return false;
  }
}

// ---------------------------------------------------------------- telegram
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendToTelegram(v: Omit<ContactInput, "website" | "token">, meta: { ip: string | null; country: string | null; steam: string | null }): Promise<boolean> {
  const token = process.env.CONTACT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.CONTACT_TELEGRAM_CHAT_ID;
  // A forum topic in that chat (message_thread_id), when the group uses topics. Optional.
  const threadId = Number(process.env.CONTACT_TELEGRAM_THREAD_ID) || undefined;
  if (!token || !chatId) {
    console.error("[contact] CONTACT_TELEGRAM_BOT_TOKEN or CONTACT_TELEGRAM_CHAT_ID is not set");
    return false;
  }
  const lines = [
    "📬 <b>New contact message</b>",
    "",
    `<b>Name:</b> ${esc(v.name)}`,
    `<b>Email:</b> ${esc(v.email)}`,
    v.telegram ? `<b>Telegram:</b> ${esc(v.telegram)}` : null,
    v.discord ? `<b>Discord:</b> ${esc(v.discord)}` : null,
    meta.steam ? `<b>Signed in as:</b> ${esc(meta.steam)}` : null,
    "",
    esc(v.message),
    "",
    `<i>${[meta.ip, meta.country].filter(Boolean).map((s) => esc(s!)).join(" · ") || "unknown origin"}</i>`,
  ].filter((l) => l !== null);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_thread_id: threadId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const r = (await res.json()) as { ok: boolean; description?: string };
    if (!r.ok) console.error("[contact] telegram rejected the message", r.description);
    return r.ok;
  } catch (e) {
    console.error("[contact] telegram send failed", e);
    return false;
  }
}

/** Check and deliver one submission. `ip` and `country` come from Cloudflare's request headers. */
export async function submitContact(input: ContactInput, meta: { ip: string | null; country: string | null; steam: string | null }): Promise<ContactResult> {
  // Honeypot: a field hidden from people. Pretend it worked so the bot moves on.
  if (input.website.trim()) return { ok: true };
  const v = validateContact(input);
  if (!v.ok) return v;
  if (meta.ip && rateLimited(meta.ip)) return { ok: false, error: "Too many messages from your network. Try again in a few minutes." };
  if (!(await verifyTurnstile(input.token, meta.ip))) return { ok: false, error: "We could not verify you are human. Complete the check and try again." };
  if (!(await sendToTelegram(v.value, meta))) return { ok: false, error: "Your message could not be sent right now. Please try again later, or reach us on Telegram." };
  return { ok: true };
}
