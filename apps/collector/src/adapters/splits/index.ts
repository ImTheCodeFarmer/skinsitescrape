/**
 * Splits.gg (splits.gg). Socket.IO at wss://splits.gg/socket.io/ with no
 * auth (the browser sends a session id in the connect payload; guests get
 * everything below without one). Behind Cloudflare; wstap connects without
 * a proxy as of 2026-09-19.
 *
 * One feed covers the whole site: `newDrop` is the site's live bet ticker,
 * pushed to every socket with no subscription. Each message carries one or
 * more settled bets in `latestDrops` (and the same bets again in
 * `highrollerDrops` / `luckyDrops` when they qualify) with the game, the
 * player, the stake, the payout and the result, losses included. Over two
 * runs on 2026-09-19 every id in the sequence arrived, and the mines feed
 * (`mines:pushHistory`) matched the ticker one for one, so it is treated
 * as complete. `setDrops` is the same shape sent once on connect with the
 * recent history, useful after a reconnect.
 *
 * So every mode is tracked from this one feed, including the private ones
 * other sites hide: battles, coinflip, bust (the site's blackjack),
 * upgrader, wheel, mines, cases, targets, towers, keno and plinko. Blackjack
 * side bets arrive as their own drops ("BJ - 21+3") and land under `bust`
 * with the main bet. Multi-player rounds (wheel, battles, coinflip) share
 * a `gameId`, kept as `round_id`; the drop id is the bet's own id.
 *
 * Amounts are integer cents of gems and the site prices a gem at $1: every
 * balance and bet in the client is `amount / 100`, and the deposit flow
 * counts a USD deposit as the same number of gems (crypto deposits carry a
 * bonus, so the effective price is lower for those). Only
 * `balanceMode: "gem"` has been seen; any other mode is stored raw only.
 *
 * Players are the site's numeric user ids. A player who plays anonymously
 * still comes through with their id; their name and avatar are kept hidden,
 * as the site shows them.
 */
import type { AdapterContext, SiteAdapter } from "../../core/adapter.js";

export const SITE = "splits";
export const GEM_USD = 1;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const usd = (v: number | string | null | undefined) => round4(((Number(v) || 0) / 100) * GEM_USD);

/** The ticker's game names → `bets.game`. Matched case-insensitively on `game.name`, then on the drop's own `name`. */
const GAMES: [RegExp, string][] = [
  [/blackjack|^bj\b/i, "bust"],
  [/case ?battle|^battles?$/i, "battles"],
  [/skin ?battle/i, "skin-battles"],
  [/upgrader ?battle/i, "upgrader-battles"],
  [/upgrade/i, "upgrader"],
  [/coin ?flip/i, "coinflip"],
  [/wheel|wof/i, "wheel"],
  [/mines/i, "mines"],
  [/case|unbox/i, "cases"],
  [/target/i, "targets"],
  [/tower/i, "towers"],
  [/keno/i, "keno"],
  [/plinko/i, "plinko"],
  [/hi ?lo/i, "hilo"],
  [/50x/i, "50x"],
];

type SpDrop = {
  id: number | string;
  userId?: string | number | null;
  gameId?: string | number | null;
  username?: string | null;
  avatar?: string | null;
  anonymous?: boolean;
  name?: string | null;
  game?: { name?: string | null } | null;
  result?: "WIN" | "LOST" | "PUSH" | string;
  betAmount?: number | string;
  payout?: number | string;
  multiplier?: number | string;
  createdAt?: string;
  gameInfo?: unknown;
  balanceMode?: string;
  count?: number;
  user?: { name?: string | null; img?: string | null; level?: number } | null;
};

type SpDrops = { latestDrops?: SpDrop[]; highrollerDrops?: SpDrop[]; luckyDrops?: SpDrop[] };

const unknown = new Set<string>();

function gameOf(d: SpDrop, ctx: AdapterContext): string {
  for (const label of [d.game?.name, d.name]) {
    if (!label) continue;
    for (const [re, game] of GAMES) if (re.test(label)) return game;
  }
  const label = d.game?.name || d.name || "unknown";
  const game = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unknown";
  if (!unknown.has(label)) {
    unknown.add(label);
    ctx.log.warn({ label }, "unmapped game name, stored under its own slug");
  }
  return game;
}

function handleDrop(d: SpDrop, receivedAt: Date, ctx: AdapterContext) {
  if (d?.id == null || d.userId == null) return;
  if (d.balanceMode && d.balanceMode !== "gem") return; // play money or an unknown balance: raw only
  const playerId = String(d.userId);
  const anon = d.anonymous === true;
  ctx.sink.player({
    site: SITE,
    externalId: playerId,
    displayName: anon ? "Anonymous" : d.username ?? d.user?.name ?? null,
    avatar: anon || !d.avatar || d.avatar === "hidden" ? null : d.avatar,
    seenAt: receivedAt,
  });
  const placedAt = d.createdAt ? new Date(d.createdAt) : receivedAt;
  const stake = usd(d.betAmount);
  const payout = usd(d.payout);
  ctx.sink.bet({
    site: SITE,
    game: gameOf(d, ctx),
    externalId: String(d.id),
    roundId: d.gameId != null ? String(d.gameId) : String(d.id),
    playerId,
    wageredUsd: stake,
    payoutUsd: payout,
    won: d.result === "WIN" ? true : d.result === "LOST" ? false : payout > stake ? true : payout < stake ? false : null,
    placedAt,
    settledAt: placedAt,
    meta: { name: d.name, gameName: d.game?.name, result: d.result, multiplier: d.multiplier, gameInfo: d.gameInfo, count: d.count, anonymous: anon },
  });
}

function handleDrops(p: SpDrops, receivedAt: Date, ctx: AdapterContext) {
  const seen = new Set<string>();
  for (const list of [p?.latestDrops, p?.highrollerDrops, p?.luckyDrops]) {
    for (const d of list ?? []) {
      const k = String(d?.id);
      if (seen.has(k)) continue;
      seen.add(k);
      handleDrop(d, receivedAt, ctx);
    }
  }
}

/** Chat, presence, rain, leaderboards, emoji tallies and the blackjack table's card-by-card stream: never stored. */
const IGNORE = new Set([
  "chat:activeUsers", "chat:PINNED_MESSAGE", "chat:default_language", "CHAT_UPDATE", "ready-to-handle", "emojies:defaults", "emojies:usage",
  "leaderBoard:data", "weekly_leaderBoard:data", "daily_blitz:countdown", "weekly_blitz:countdown", "reward:rainCounter", "timestamp",
  "steam:trader:settings", "settings:games", "game:gameAvailability", "rust:withdraw:clear", "login_required",
]);
const isNoise = (event: string) => IGNORE.has(event) || event.startsWith("blackjack:") || event.startsWith("chat:") || event.startsWith("emojies:");

export const splits: SiteAdapter = {
  site: SITE,
  connection: { url: "wss://splits.gg", path: "/socket.io/", pageUrl: "https://splits.gg/" },

  handle({ event, args, receivedAt }, ctx) {
    if (isNoise(event)) return;
    const p = args[0];
    ctx.sink.rawEvent({ site: SITE, event, payload: args.length === 1 ? p : args, receivedAt });
    if (event === "newDrop" || event === "setDrops") return handleDrops(p as SpDrops, receivedAt, ctx);
    // mines:pushHistory, coinflip:*, WOF*: round colour only; the ticker already has every bet. Raw only.
  },
};
