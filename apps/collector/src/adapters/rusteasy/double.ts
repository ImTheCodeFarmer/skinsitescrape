/**
 * Double (roulette), room "roullete" (sic). `roullete_bet` (a JSON string)
 * is one bet on a colour; `doubledip` means the player doubled and `amount`
 * is the new total for that colour. `roullete_slider` is the spin: result
 * 0..14, where 0 is gold (14x), 1 and 14 are bait (7x), other evens red and
 * odds black (2x), as the site's own client scores them. No fee.
 *
 * Rounds carry no id, so a round is named by the time its spin arrived and
 * placed at the time of its first bet; both come from `received_at`, so a
 * reparse reproduces them.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { SITE, isHouse, parse, seen, usd } from "./site.js";
import type { ReDoubleBet, ReDoubleSpin } from "./types.js";

const PAYOUT: Record<string, number> = { red: 2, black: 2, gold: 14, bait: 7 };

export function colourOf(result: number): string {
  if (result === 0) return "gold";
  if (result === 1 || result === 14) return "bait";
  return result % 2 === 0 ? "red" : "black";
}

type Bet = { id: string; colour: string; amount: number };
let bets = new Map<string, Bet>();
let openedAt: Date | null = null;

export function handleDoubleBet(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const b = parse<ReDoubleBet>(payload);
  if (!b?.steamid64 || !PAYOUT[b.color]) return;
  const id = seen(b, receivedAt, ctx);
  if (!id) return;
  openedAt ??= receivedAt;
  const k = `${id}|${b.color}`;
  const amount = usd(b.amount);
  const cur = bets.get(k);
  // A double-dip replaces the amount; anything else adds a new bet on the colour.
  bets.set(k, { id, colour: b.color, amount: b.doubledip || !cur ? amount : cur.amount + amount });
}

export function handleDoubleSpin(payload: unknown, receivedAt: Date, ctx: AdapterContext) {
  const s = parse<ReDoubleSpin>(payload);
  if (typeof s?.result !== "number") return;
  const winning = colourOf(s.result);
  const roundId = receivedAt.toISOString();
  const placedAt = openedAt ?? receivedAt;
  for (const b of bets.values()) {
    const won = b.colour === winning;
    ctx.sink.bet({
      site: SITE,
      game: "roulette",
      externalId: `${roundId}:${b.id}:${b.colour}`,
      roundId,
      playerId: b.id,
      isHouse: isHouse(b.id),
      wageredUsd: b.amount,
      payoutUsd: won ? usd(b.amount * PAYOUT[b.colour]) : 0,
      won,
      placedAt,
      settledAt: receivedAt,
      meta: { colour: b.colour, result: s.result, winning },
    });
  }
  bets = new Map();
  openedAt = null;
}
