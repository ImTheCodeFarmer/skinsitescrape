/**
 * RustMagic (rustmagic.com). Socket.IO at wss://api.rustmagic.com/socket.io/
 * with empty `token` and `totp` on the query for a guest. Behind Cloudflare;
 * wstap connects without a proxy as of 2026-09-17.
 *
 * One room covers the whole site: `betting:join` turns on
 * `betting:live-bets`, the site's live bet table. Each message carries one
 * settled bet in `allBets` (and again in `myBets`, plus the high-roller and
 * lucky lists) with its type, player, stake and payout, losses included.
 * Bet ids are one sequence across every game: over seven minutes on
 * 2026-09-17, 249 of the 255 ids issued after joining arrived, and the rest
 * were plausibly still unsettled (battles report up to two minutes after
 * they are placed). `date` is when the bet was placed.
 *
 * So every mode is tracked from this one feed, including the private ones
 * other sites hide: battles, upgrader, mines, keno, flipper, Magic Wheel
 * (ROULETTE), case opening (UNBOXING) and the third-party slots, which are
 * most of the site's bets. Battles only list real players; the rooms with
 * round detail (`game_battles`, `game_roulette`) add nothing the stats need
 * and are not joined.
 *
 * Amounts are hundredths of a coin; the site's FAQ puts a coin at $0.66.
 * The feed has no Steam ids: players are the site's own numeric user ids.
 */
import type { AdapterContext, SiteAdapter } from "../../core/adapter.js";

export const SITE = "rustmagic";
export const COIN_USD = 0.66;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const usd = (v: number | string | null | undefined) => round4(((Number(v) || 0) / 100) * COIN_USD);

/** The client's bet type enum → `bets.game`. Anything with a `slotsGameCode` is a slot, whatever its type says (the type is the slot's title). */
const GAMES: Record<string, string> = {
  BATTLE: "battles",
  UPGRADE: "upgrader",
  MINES: "mines",
  KENO: "keno",
  FLIPPER: "flipper",
  COINFLIP: "coinflip",
  ROULETTE: "roulette",
  CRASH: "crash",
  UNBOXING: "cases",
  SLOTS: "slots",
};

type RmBet = {
  id?: number | string;
  type?: string;
  user?: { id?: number | string; username?: string | null; avatarUrl?: string | null } | null;
  amount?: string | number;
  payout?: string | number;
  date?: string;
  slotsGameCode?: string;
  battle?: { id?: string };
};

const unknown = new Set<string>();

function handleBet(b: RmBet, receivedAt: Date, ctx: AdapterContext) {
  if (b?.id == null || !b.type) return;
  const slot = Boolean(b.slotsGameCode);
  let game = slot ? "slots" : GAMES[b.type];
  if (!game) {
    game = b.type.toLowerCase();
    if (!unknown.has(b.type)) {
      unknown.add(b.type);
      ctx.log.warn({ type: b.type }, "unmapped bet type, stored under its own name");
    }
  }
  // A player who hides their profile may come through without a user.
  const playerId = b.user?.id != null ? String(b.user.id) : "hidden";
  const placedAt = b.date ? new Date(b.date) : receivedAt;
  ctx.sink.player({ site: SITE, externalId: playerId, displayName: b.user?.username ?? null, avatar: b.user?.avatarUrl ?? null, seenAt: receivedAt });
  const stake = usd(b.amount);
  const payout = usd(b.payout);
  ctx.sink.bet({
    site: SITE,
    game,
    externalId: String(b.id),
    roundId: b.battle?.id ?? String(b.id),
    playerId,
    wageredUsd: stake,
    payoutUsd: payout,
    won: payout > stake,
    placedAt: Number.isNaN(placedAt.getTime()) ? receivedAt : placedAt,
    settledAt: receivedAt,
    meta: slot ? { slot: b.type, slotCode: b.slotsGameCode } : undefined,
  });
}

export const rustmagic: SiteAdapter = {
  site: SITE,
  connection: {
    url: "wss://api.rustmagic.com",
    path: "/socket.io/",
    query: { token: "", totp: "" },
    pageUrl: "https://rustmagic.com/",
  },

  onConnect(ctx) {
    ctx.emit("betting:join", {});
  },

  handle({ event, args, receivedAt }, ctx) {
    if (event !== "betting:live-bets") return; // online-users, rain:balance and the like
    const bets = (args[0] as { allBets?: RmBet[] })?.allBets;
    if (!Array.isArray(bets) || !bets.length) return;
    // The other lists repeat bets already in `allBets`; keep the raw event to that.
    ctx.sink.rawEvent({ site: SITE, event, payload: { allBets: bets }, receivedAt });
    for (const b of bets) handleBet(b, receivedAt, ctx);
  },
};
