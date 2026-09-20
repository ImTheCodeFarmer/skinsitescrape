import "server-only";
import { decryptSecret, encryptSecret, formatAlert, ROUND_URLS, sql } from "@casino/db";
import { db } from "./db";
import { CASINOS, gameLabel } from "./casinos";
import { KIND_LABELS, type AlertBot, type AlertRule, type FoundPlayer, type PlayerFilters, type RuleKind } from "./alerts-shared";
export * from "./alerts-shared";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await db().execute(q)) as unknown as Row[];
const str = (v: unknown) => (v == null ? null : String(v));

// ---------------------------------------------------------------- telegram
type TgResult<T> = { ok: true; result: T } | { ok: false; description?: string; error_code?: number };

async function tg<T>(token: string, method: string, body?: unknown): Promise<TgResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return (await res.json()) as TgResult<T>;
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : "network error" };
  }
}

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

// ---------------------------------------------------------------- bots
export async function getBot(steamId: string): Promise<AlertBot | null> {
  const r = await rows(sql`SELECT bot_username, chat_id, chat_title, connected_at, last_error, created_at FROM alert_bots WHERE steam_id = ${steamId}`);
  const x = r[0];
  if (!x) return null;
  return { botUsername: str(x.bot_username), chatId: str(x.chat_id), chatTitle: str(x.chat_title), connectedAt: x.connected_at ? new Date(x.connected_at as string).toISOString() : null, lastError: str(x.last_error), createdAt: new Date(x.created_at as string).toISOString() };
}

async function tokenFor(steamId: string): Promise<string | null> {
  const r = await rows(sql`SELECT token_enc FROM alert_bots WHERE steam_id = ${steamId}`);
  return r[0] ? decryptSecret(String(r[0].token_enc)) : null;
}

/** Validate a BotFather token with getMe, then store it encrypted. A new token resets the chat connection. */
export async function saveToken(steamId: string, raw: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const token = raw.trim();
  if (!TOKEN_RE.test(token)) return { ok: false, error: "That does not look like a bot token. It has the form 123456789:ABCdef..., exactly as BotFather sent it." };
  const me = await tg<{ id: number; username?: string; is_bot?: boolean }>(token, "getMe");
  if (!me.ok) return { ok: false, error: me.error_code === 401 ? "Telegram rejected this token. Copy it again from BotFather, or use /token there to see it." : `Telegram said: ${me.description ?? "unknown error"}` };
  const username = me.result.username ?? "bot";
  await db().execute(sql`
    INSERT INTO alert_bots (steam_id, token_enc, bot_id, bot_username, chat_id, chat_title, connected_at, last_error, created_at, updated_at)
    VALUES (${steamId}, ${encryptSecret(token)}, ${String(me.result.id)}, ${username}, NULL, NULL, NULL, NULL, now(), now())
    ON CONFLICT (steam_id) DO UPDATE SET token_enc = EXCLUDED.token_enc, bot_id = EXCLUDED.bot_id, bot_username = EXCLUDED.bot_username,
      chat_id = NULL, chat_title = NULL, connected_at = NULL, last_error = NULL, updated_at = now()`);
  return { ok: true, username };
}

/**
 * Find the chat the user opened with their bot: the newest message in the
 * bot's update queue. The user has to send the bot anything (/start does)
 * before this can succeed.
 */
export async function connectChat(steamId: string): Promise<{ ok: true; chatTitle: string } | { ok: false; error: string }> {
  const token = await tokenFor(steamId);
  if (!token) return { ok: false, error: "Save your bot token first." };
  const up = await tg<{ message?: { chat: { id: number; type: string; title?: string; first_name?: string; username?: string } } }[]>(token, "getUpdates", { limit: 100, allowed_updates: ["message"] });
  if (!up.ok) return { ok: false, error: `Telegram said: ${up.description ?? "unknown error"}` };
  const msg = [...up.result].reverse().find((u) => u.message?.chat)?.message;
  if (!msg) return { ok: false, error: "No message yet. Open your bot in Telegram, press Start (or send it anything), then try again." };
  const chat = msg.chat;
  const chatTitle = chat.title ?? [chat.first_name, chat.username ? `@${chat.username}` : null].filter(Boolean).join(" ") ?? String(chat.id);
  await db().execute(sql`UPDATE alert_bots SET chat_id = ${String(chat.id)}, chat_title = ${chatTitle}, connected_at = now(), last_error = NULL, updated_at = now() WHERE steam_id = ${steamId}`);
  await tg(token, "sendMessage", { chat_id: chat.id, text: "✅ Connected to SkinWagerTracker. Alerts you create on the dashboard will arrive here." });
  return { ok: true, chatTitle };
}

export async function sendTest(steamId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [token, bot] = await Promise.all([tokenFor(steamId), getBot(steamId)]);
  if (!token || !bot?.chatId) return { ok: false, error: "Connect a chat first." };
  const r = await tg(token, "sendMessage", { chat_id: bot.chatId, text: "🔔 Test alert from SkinWagerTracker. You are all set." });
  if (!r.ok) {
    await db().execute(sql`UPDATE alert_bots SET last_error = ${r.description ?? "send failed"}, updated_at = now() WHERE steam_id = ${steamId}`);
    return { ok: false, error: `Telegram said: ${r.description ?? "send failed"}` };
  }
  await db().execute(sql`UPDATE alert_bots SET last_error = NULL, updated_at = now() WHERE steam_id = ${steamId}`);
  return { ok: true };
}

export async function removeBot(steamId: string) {
  await db().execute(sql`DELETE FROM alert_bots WHERE steam_id = ${steamId}`);
}

// ---------------------------------------------------------------- rules
export async function listRules(steamId: string): Promise<AlertRule[]> {
  const r = await rows(sql`
    SELECT r.*, p.display_name FROM alert_rules r
    LEFT JOIN players p ON r.site = p.site AND r.player_id = p.external_id
    WHERE r.steam_id = ${steamId} ORDER BY r.created_at DESC`);
  return r.map((x) => ({
    id: Number(x.id), name: String(x.name), kind: x.kind as RuleKind, site: str(x.site), game: str(x.game), playerId: str(x.player_id), playerName: str(x.display_name),
    minWagered: x.min_wagered == null ? null : Number(x.min_wagered), minNetWin: x.min_net_win == null ? null : Number(x.min_net_win),
    cooldownSeconds: Number(x.cooldown_seconds) || 0, enabled: Boolean(x.enabled), createdAt: new Date(x.created_at as string).toISOString(),
    lastFiredAt: x.last_fired_at ? new Date(x.last_fired_at as string).toISOString() : null, firedCount: Number(x.fired_count) || 0,
  }));
}

export type RuleInput = { name: string; kind: RuleKind; site: string | null; game: string | null; playerId: string | null; minWagered: number | null; minNetWin: number | null; cooldownSeconds: number };

export function validateRule(i: RuleInput): string | null {
  if (!i.name.trim()) return "Give the alert a name.";
  if (!(i.kind in KIND_LABELS)) return "Pick what the alert watches.";
  if (i.site && !CASINOS.some((c) => c.slug === i.site)) return "Unknown site.";
  if (i.kind === "big_bet" && !(i.minWagered! > 0)) return "Big bet needs a minimum bet size.";
  if (i.kind === "big_win" && !(i.minNetWin! > 0)) return "Big win needs a minimum net win.";
  if (i.kind === "player_bet" && (!i.site || !i.playerId)) return "Player bet needs the site and the player's id. Copy them from the player's profile.";
  if (i.cooldownSeconds < 0 || i.cooldownSeconds > 86_400 * 7) return "Cooldown must be between 0 and 7 days.";
  return null;
}

export async function createRule(steamId: string, i: RuleInput) {
  const count = await rows(sql`SELECT count(*) n FROM alert_rules WHERE steam_id = ${steamId}`);
  if (Number(count[0]?.n) >= 50) throw new Error("You have 50 alerts already; delete one first.");
  await db().execute(sql`
    INSERT INTO alert_rules (steam_id, name, kind, site, game, player_id, min_wagered, min_net_win, cooldown_seconds)
    VALUES (${steamId}, ${i.name.trim().slice(0, 60)}, ${i.kind}, ${i.site}, ${i.game}, ${i.playerId}, ${i.kind === "big_win" ? null : i.minWagered}, ${i.kind === "big_win" ? i.minNetWin : null}, ${i.cooldownSeconds})`);
}

export async function updateRule(steamId: string, id: number, i: RuleInput) {
  await db().execute(sql`
    UPDATE alert_rules SET name = ${i.name.trim().slice(0, 60)}, kind = ${i.kind}, site = ${i.site}, game = ${i.game}, player_id = ${i.playerId},
      min_wagered = ${i.kind === "big_win" ? null : i.minWagered}, min_net_win = ${i.kind === "big_win" ? i.minNetWin : null}, cooldown_seconds = ${i.cooldownSeconds}
    WHERE id = ${id} AND steam_id = ${steamId}`);
}

export async function setRuleEnabled(steamId: string, id: number, enabled: boolean) {
  await db().execute(sql`UPDATE alert_rules SET enabled = ${enabled} WHERE id = ${id} AND steam_id = ${steamId}`);
}

export async function deleteRule(steamId: string, id: number) {
  await db().execute(sql`DELETE FROM alert_rules WHERE id = ${id} AND steam_id = ${steamId}`);
}


/**
 * Send a sample of one rule to the owner's chat, built from the rule
 * itself: its site and game where set, the followed player's real name for
 * a player rule, and amounts just above the rule's thresholds.
 */
export async function testRule(steamId: string, id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [token, bot, rules] = await Promise.all([tokenFor(steamId), getBot(steamId), listRules(steamId)]);
  const r = rules.find((x) => x.id === id);
  if (!r) return { ok: false, error: "That alert no longer exists." };
  if (!token || !bot?.chatId) return { ok: false, error: "Connect a chat first." };
  const site = r.site ?? "rustypot";
  const game = r.game ?? (r.kind === "big_win" ? "crash" : "coinflip");
  const wagered = r.kind === "big_win" ? Math.max(100, (r.minNetWin ?? 0) / 4) : Math.max(r.minWagered ?? 0, 25) * 1.2;
  const payout = r.kind === "big_win" ? wagered + (r.minNetWin ?? 0) * 1.1 : wagered * 2;
  const text = formatAlert(r, {
    site, game, playerId: r.playerId ?? "76561198000000000", playerName: r.playerName ?? (r.kind === "player_bet" ? r.playerId ?? "Player" : "SamplePlayer"),
    wageredUsd: Math.round(wagered), payoutUsd: Math.round(payout), won: true,
    roundId: ROUND_URLS[site]?.[game] ? "sample" : null,
  }, { webUrl: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_WEB_URL ?? null, test: true });
  const res = await tg(token, "sendMessage", { chat_id: bot.chatId, text, parse_mode: "HTML", disable_web_page_preview: true });
  if (!res.ok) {
    await db().execute(sql`UPDATE alert_bots SET last_error = ${res.description ?? "send failed"}, updated_at = now() WHERE steam_id = ${steamId}`);
    return { ok: false, error: `Telegram said: ${res.description ?? "send failed"}` };
  }
  return { ok: true };
}

/**
 * Players matching a set of filters over the last 30 days of the daily
 * rollup: name or id search, one site, favourite game (the game they wager
 * most on), a minimum average bet, sorted as asked. At most 30 rows.
 */
export async function findPlayers(f: PlayerFilters): Promise<FoundPlayer[]> {
  const q = f.q.trim();
  const order =
    f.sort === "avg_bet" ? sql`avg_bet DESC` : f.sort === "bets" ? sql`bets DESC` : f.sort === "last_active" ? sql`last_active DESC, wagered DESC` : sql`wagered DESC`;
  const r = await rows(sql`
    WITH agg AS (
      SELECT d.site, d.player_id, sum(d.wagered_usd) wagered, sum(d.bets) bets, max(d.bucket) last_active, count(DISTINCT d.bucket) active_days,
             (array_agg(d.game ORDER BY d.wagered_usd DESC))[1] favorite
      FROM player_daily d
      JOIN players p ON p.site = d.site AND p.external_id = d.player_id AND NOT p.is_house
      WHERE d.bucket >= now() - interval '30 days'
        ${f.site ? sql`AND d.site = ${f.site}` : sql``}
        ${q ? sql`AND (p.display_name ILIKE ${"%" + q + "%"} OR p.external_id = ${q})` : sql``}
      GROUP BY d.site, d.player_id
    ),
    s AS (SELECT *, CASE WHEN bets > 0 THEN wagered / bets ELSE 0 END avg_bet FROM agg)
    SELECT s.*, p.display_name, p.avatar FROM s JOIN players p ON p.site = s.site AND p.external_id = s.player_id
    WHERE true
      ${f.game ? sql`AND s.favorite = ${f.game}` : sql``}
      ${f.minAvgBet ? sql`AND s.avg_bet >= ${f.minAvgBet}` : sql``}
    ORDER BY ${order} LIMIT 30`);
  return r.map((x) => ({
    site: String(x.site), id: String(x.player_id), handle: str(x.display_name) ?? String(x.player_id), avatar: str(x.avatar),
    wagered: Number(x.wagered) || 0, bets: Number(x.bets) || 0, avgBet: Number(x.avg_bet) || 0,
    favorite: gameLabel(String(x.favorite ?? "")), favoriteKey: String(x.favorite ?? ""), lastActive: new Date(x.last_active as string).toISOString(), activeDays: Number(x.active_days) || 0,
  }));
}
