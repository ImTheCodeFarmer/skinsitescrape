/**
 * Jackpot rounds on Rustypot are only named (given an _id) when they end:
 * deposits arrive as bare player rows, and "jackpot winnerInfo" /
 * "ensure jackpot reset" carry the round id. So this module keeps the
 * in-flight round in memory keyed by the current game hash, then writes the
 * round, entries and bets when the winner is announced.
 *
 * Tax: the feed never states it. Pot totals in results match the sum of
 * deposits (pre-tax), so house_net is recorded at JACKPOT_TAX_RATE and
 * flagged as estimated in meta.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, HOUSE_ID } from "./coinflip.js";
import type { RpJackpotDeposit, RpJackpotResult, RpJackpotWinnerInfo } from "./types.js";

/** Rake on a jackpot: 5% of the pot, measured on the legacy scraper's recorded tax (5.00% ± 0.03 over 9.8k rounds). */
export const JACKPOT_TAX_RATE = 0.05;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

type Deposit = { player: RpJackpotDeposit; at: Date; amount: number };
type Live = { hash: string | null; startedAt: Date; deposits: Deposit[] };

const live: Live = { hash: null, startedAt: new Date(), deposits: [] };

function reset(at: Date) {
  live.hash = null;
  live.startedAt = at;
  live.deposits = [];
}

export function handleJackpotHash(hash: unknown, receivedAt: Date) {
  if (typeof hash !== "string") return;
  if (live.hash && live.hash !== hash) reset(receivedAt);
  live.hash = hash;
}

/** One row per deposit transaction. A player who deposits twice appears twice. */
function recordDeposit(d: RpJackpotDeposit, at: Date, ctx: AdapterContext) {
  if (!d?.id) return;
  ctx.sink.player({ site: SITE, externalId: d.id, displayName: d.displayName, avatar: d.image, isHouse: d.id === HOUSE_ID, seenAt: at });
  const amount = round4(typeof d.userDepositTotal === "number" ? d.userDepositTotal : (d.depositedItems ?? []).reduce((a, i) => a + i.price, 0));
  if (live.deposits.length === 0) live.startedAt = at;
  live.deposits.push({ player: d, at, amount });
}

/** "jackpot deposit" – a single new deposit in the current round. */
export function handleJackpotDeposit(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  recordDeposit(payload as RpJackpotDeposit, receivedAt, ctx);
}

/** "return jackpot deposit" – every deposit so far in the current round (sent on connect). */
export function handleJackpotDeposits(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  if (!Array.isArray(payload)) return;
  live.deposits = [];
  // Rows share one receivedAt; offset by index so each keeps a distinct primary key.
  payload.forEach((d, i) => recordDeposit(d as RpJackpotDeposit, new Date(receivedAt.getTime() - (payload.length - i)), ctx));
}

/** "jackpot winnerInfo" – round id + winner. Finalises the in-flight round. */
export function handleJackpotWinner(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const w = payload as RpJackpotWinnerInfo;
  if (!w?._id) return;
  const entries = live.deposits;
  const depositSum = round4(entries.reduce((a, e) => a + e.amount, 0));
  const pot = round4(typeof w.total === "number" ? w.total : depositSum);
  const winner = entries.find((e) => e.player.displayName === w.name && e.player.image === w.image) ?? entries.find((e) => e.player.displayName === w.name);
  const tax = round4(pot * JACKPOT_TAX_RATE);
  const winnerIsHouse = winner?.player.id === HOUSE_ID;
  const houseStake = entries.filter((e) => e.player.id === HOUSE_ID).reduce((a, e) => a + e.amount, 0);
  const houseNet = winnerIsHouse ? round4(pot - houseStake) : round4(tax - houseStake);
  // If we joined mid-round we may be missing deposits; flag it so the round can be excluded from per-player stats.
  const partial = Math.abs(pot - depositSum) > 0.05;

  ctx.sink.jackpot({
    site: SITE,
    externalId: w._id,
    createdAt: live.startedAt,
    status: "Ended",
    hash: live.hash,
    potUsd: pot,
    entries: entries.length,
    winnerId: winner?.player.id ?? null,
    taxUsd: winnerIsHouse ? 0 : tax,
    houseNetUsd: entries.length && !partial ? houseNet : null,
    settledAt: receivedAt,
    meta: { winnerName: w.name, winnerChance: w.chance, taxEstimated: true, unmatchedWinner: !winner, partial, depositSum },
  });

  for (const e of entries) {
    ctx.sink.jackpotEntry({ site: SITE, jackpotId: w._id, playerId: e.player.id, amountUsd: e.amount, items: e.player.depositedItems, depositedAt: e.at });
  }
  // Bets only for complete rounds, otherwise payouts exceed wagers and skew the rollups.
  if (!partial) {
    let paid = false;
    for (const e of entries) {
      const won = !paid && e.player.id === winner?.player.id;
      if (won) paid = true; // pot is paid once even if the winner deposited several times
      ctx.sink.bet({
        site: SITE,
        game: "jackpot",
        externalId: `${w._id}:${e.player.id}:${e.at.getTime()}`,
        roundId: w._id,
        playerId: e.player.id,
        isHouse: e.player.id === HOUSE_ID,
        wageredUsd: e.amount,
        payoutUsd: won ? round4(pot - (winnerIsHouse ? 0 : tax)) : 0,
        won: e.player.id === winner?.player.id,
        placedAt: e.at,
        settledAt: receivedAt,
      });
    }
  }
  reset(receivedAt);
}

/** "ensure jackpot reset" – authoritative pot/ticket for the round that just ended. */
export function handleJackpotReset(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const r = payload as RpJackpotResult;
  if (!r?.id) return;
  ctx.sink.jackpot({
    site: SITE,
    externalId: r.id,
    createdAt: receivedAt, // ignored on conflict; only inserts if winnerInfo was missed
    status: "Ended",
    potUsd: typeof r.potTotal === "number" ? round4(r.potTotal) : null,
    winnerTicket: typeof r.ticket === "number" ? r.ticket : null,
    settledAt: receivedAt,
  });
  reset(receivedAt);
}

/** "return jackpotGameHistory" – recent finished rounds; fills gaps from downtime with pot totals only. */
export function handleJackpotHistory(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  if (!Array.isArray(payload)) return;
  for (const r of payload as RpJackpotResult[]) {
    if (!r?.id) continue;
    ctx.sink.jackpot({
      site: SITE,
      externalId: r.id,
      createdAt: receivedAt,
      status: "Ended",
      potUsd: typeof r.potTotal === "number" ? round4(r.potTotal) : null,
      winnerTicket: typeof r.ticket === "number" ? r.ticket : null,
      settledAt: receivedAt,
      meta: { winnerName: r.winnerDisplayName, winnerChance: r.winnerChance, fromHistory: true },
    });
  }
}
