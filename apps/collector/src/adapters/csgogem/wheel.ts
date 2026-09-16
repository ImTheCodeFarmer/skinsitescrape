/**
 * The two round-based wheel games. Both send the current round on subscribe
 * (`<game>.round`, with every wager so far), `<game>.onNewRound`, wager
 * updates, and `<game>.onGameSpin` with the result.
 *
 * Slide: a player picks a target multiplier and wins floor(amount × target)
 * when target ≤ the winning multiplier (rule from the site's own client).
 * `slide.wagers` rows are deltas keyed by user + target.
 *
 * Roulette ("Double"): red / black pay 2×, green 14×. `roulette.wagers`
 * carries a user's running totals for the round and replaces their entry.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, seen, usd } from "./site.js";
import type { GemColour, GemRouletteRound, GemRouletteSpin, GemRouletteWagers, GemSlideRound, GemSlideSpin, GemSlideWager } from "./types.js";

const COLOURS: GemColour[] = ["red", "green", "black"];
const ROULETTE_PAYOUT: Record<GemColour, number> = { red: 2, green: 14, black: 2 };

// ---------------------------------------------------------------- slide

type SlideBet = { userId: string; multiplier: number; amount: number };
const slide: { round: number | null; createdAt: Date; hash: string | null; settled: boolean; bets: Map<string, SlideBet> } = {
  round: null, createdAt: new Date(), hash: null, settled: false, bets: new Map(),
};

function slideReset(round: number, createdAt: Date, hash: string | null) {
  slide.round = round;
  slide.createdAt = createdAt;
  slide.hash = hash;
  slide.settled = false;
  slide.bets = new Map();
}

function slideAdd(userId: string, multiplier: number, amount: number) {
  const k = `${userId}|${multiplier}`;
  const cur = slide.bets.get(k);
  if (cur) cur.amount += amount;
  else slide.bets.set(k, { userId, multiplier, amount });
}

/** `slide.round`: full state of the current round, sent on subscribe. */
export function handleSlideRound(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const r = payload as GemSlideRound;
  if (!r?.round) return;
  slideReset(r.round, r.createdAt ? new Date(r.createdAt) : receivedAt, r.hash ?? null);
  for (const [userId, u] of Object.entries(r.wagers ?? {})) {
    seen(u.user, userId, receivedAt, ctx);
    for (const w of u.wagers ?? []) slideAdd(userId, w.multiplier, w.amount);
  }
  if (typeof r.winningMultiplier === "number" && r.gameState !== "OPEN" && r.gameState !== "LOCKING_IN") {
    settleSlide(r.winningMultiplier, !!r.isJackpot, receivedAt, ctx);
  }
}

export function handleSlideNewRound(payload: unknown, receivedAt: Date) {
  const r = payload as GemSlideRound;
  if (!r?.round) return;
  slideReset(r.round, r.createdAt ? new Date(r.createdAt) : receivedAt, r.hash ?? null);
}

export function handleSlideWagers(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  if (!Array.isArray(payload) || slide.round == null || slide.settled) return;
  for (const w of payload as GemSlideWager[]) {
    const userId = w.userID ?? w.user?.userID;
    if (!userId || typeof w.multiplier !== "number") continue;
    if (w.user) seen(w.user, userId, receivedAt, ctx);
    slideAdd(userId, w.multiplier, Number(w.amount) || 0);
  }
}

export function handleSlideSpin(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const s = payload as GemSlideSpin;
  if (typeof s?.winningMultiplier !== "number") return;
  settleSlide(s.winningMultiplier, !!s.isJackpot, receivedAt, ctx);
}

function settleSlide(winning: number, isJackpot: boolean, receivedAt: Date, ctx: AdapterContext) {
  if (slide.round == null || slide.settled) return;
  slide.settled = true;
  const roundId = String(slide.round);
  for (const b of slide.bets.values()) {
    if (b.amount <= 0) continue;
    const won = b.multiplier <= winning;
    const payout = won ? Math.floor(b.amount * b.multiplier) : 0;
    ctx.sink.bet({
      site: SITE,
      game: "slide",
      externalId: `${roundId}:${b.userId}:${b.multiplier}`,
      roundId,
      playerId: b.userId,
      wageredUsd: usd(b.amount),
      payoutUsd: usd(payout),
      won,
      placedAt: slide.createdAt,
      settledAt: receivedAt,
      meta: { target: b.multiplier, result: winning, isJackpot, hash: slide.hash },
    });
  }
}

// ---------------------------------------------------------------- roulette

const roulette: { round: number | null; createdAt: Date; hash: string | null; settled: boolean; wagers: GemRouletteWagers } = {
  round: null, createdAt: new Date(), hash: null, settled: false, wagers: {},
};

function rouletteReset(round: number, createdAt: Date, hash: string | null) {
  roulette.round = round;
  roulette.createdAt = createdAt;
  roulette.hash = hash;
  roulette.settled = false;
  roulette.wagers = {};
}

function rouletteMerge(w: GemRouletteWagers, receivedAt: Date, ctx: AdapterContext) {
  for (const [userId, u] of Object.entries(w ?? {})) {
    if (!userId || !u) continue;
    seen(u.user, userId, receivedAt, ctx);
    roulette.wagers[userId] = u;
  }
}

export function handleRouletteRound(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const r = payload as GemRouletteRound;
  if (!r?.round) return;
  rouletteReset(r.round, r.createdAt ? new Date(r.createdAt) : receivedAt, r.hash ?? null);
  rouletteMerge(r.wagers ?? {}, receivedAt, ctx);
  if (r.winningColour && r.gameState !== "OPEN" && r.gameState !== "LOCKING_IN") settleRoulette(r.winningColour, receivedAt, ctx);
}

export function handleRouletteNewRound(payload: unknown, receivedAt: Date) {
  const r = payload as GemRouletteRound;
  if (!r?.round) return;
  rouletteReset(r.round, r.createdAt ? new Date(r.createdAt) : receivedAt, r.hash ?? null);
}

export function handleRouletteWagers(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  if (!payload || typeof payload !== "object" || roulette.round == null || roulette.settled) return;
  rouletteMerge(payload as GemRouletteWagers, receivedAt, ctx);
}

export function handleRouletteSpin(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const s = payload as GemRouletteSpin;
  if (!COLOURS.includes(s?.winningColour)) return;
  settleRoulette(s.winningColour, receivedAt, ctx);
}

function settleRoulette(winning: GemColour, receivedAt: Date, ctx: AdapterContext) {
  if (roulette.round == null || roulette.settled) return;
  roulette.settled = true;
  const roundId = String(roulette.round);
  for (const [userId, u] of Object.entries(roulette.wagers)) {
    for (const colour of COLOURS) {
      const amount = Number(u[colour]) || 0;
      if (amount <= 0) continue;
      const won = colour === winning;
      ctx.sink.bet({
        site: SITE,
        game: "roulette",
        externalId: `${roundId}:${userId}:${colour}`,
        roundId,
        playerId: userId,
        wageredUsd: usd(amount),
        payoutUsd: usd(won ? amount * ROULETTE_PAYOUT[colour] : 0),
        won,
        placedAt: roulette.createdAt,
        settledAt: receivedAt,
        meta: { colour, result: winning, hash: roulette.hash },
      });
    }
  }
}
