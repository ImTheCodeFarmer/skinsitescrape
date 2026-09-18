/**
 * Case Royale, a jackpot of case openings: players add cases to a shared
 * game, everything unboxed goes into the pot, and a draw weighted by each
 * player's stake picks who takes it. On the wire the game is a
 * `BoxJackpotGame` and each entrant a `BoxJackpotPlayer`, which
 * `createOrUpdateBoxJackpotPlayer` pushes on every change: `totalBet` in the
 * player's own currency and `totalBetBase` in the game's base currency (USD;
 * 10.58 TKN was 7.406 USD, the 0.70 rate), `boxCount`, and `won`, null until
 * the draw. The game's `totalPayout` (USD) is what the winner takes, as the
 * site's own history shows (game 212484: 10.752 staked, 5.054 paid to the
 * one player with `won`).
 *
 * Every player update with a decided `won` settles that player's row from
 * the game figures it carries, so nothing has to be held between messages.
 * Rounds are infrequent (about one an hour) and the draw's own messages
 * were not observed while this was written, so the sequence is inferred
 * from the schema and the history query; `updateBoxJackpotGame` is kept raw
 * for a reparse should the player updates turn out to lack the flag.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { knownCurrency, seen, SITE, usd, type RollUser } from "./site.js";

type RoyaleGame = { id?: string; status?: string; createdAt?: string; totalBet?: number; totalBetBase?: number; totalPayout?: number; currency?: string; currencyBase?: string; playerCount?: number; boxCount?: number };
type RoyalePlayer = { id: string; totalBet?: number; currency?: string; totalBetBase?: number; currencyBase?: string; updatedAt?: string; boxCount?: number; won?: boolean | null; boxJackpotGame?: RoyaleGame | null; user?: RollUser | null };

export function handleRoyalePlayer(payload: unknown, at: Date, ctx: AdapterContext) {
  const p = (payload as { createOrUpdateBoxJackpotPlayer?: { boxJackpotPlayer?: RoyalePlayer } })?.createOrUpdateBoxJackpotPlayer?.boxJackpotPlayer;
  if (!p?.id || p.won == null || !p.boxJackpotGame?.id) return;
  const g = p.boxJackpotGame;
  const playerId = seen(p.user, at, ctx);
  if (!playerId) return;
  const base = p.currencyBase ?? g.currencyBase ?? "USD";
  const stake = usd(p.totalBetBase, base);
  const payout = p.won ? usd(g.totalPayout, g.currency ?? base) : 0;
  ctx.sink.bet({
    site: SITE,
    game: "royale",
    externalId: p.id,
    roundId: g.id,
    playerId,
    wageredUsd: stake,
    payoutUsd: payout,
    won: Boolean(p.won),
    placedAt: g.createdAt ? new Date(g.createdAt) : at,
    settledAt: at,
    meta: {
      boxes: p.boxCount ?? null,
      stakeOriginal: p.totalBet ?? null,
      currency: p.currency ?? null,
      potStakedUsd: usd(g.totalBetBase, base),
      potUsd: usd(g.totalPayout, g.currency ?? base),
      players: g.playerCount ?? null,
      ...(knownCurrency(base) && knownCurrency(g.currency ?? base) ? {} : { currencyUnknown: true }),
    },
  });
}
