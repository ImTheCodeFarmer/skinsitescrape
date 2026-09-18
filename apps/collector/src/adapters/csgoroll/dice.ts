/**
 * Dice and the upgrader, which is a dice roll under the hood: `createDiceBets`
 * streams every settled bet on the site, losses included, with `gameType`
 * DICE or UPGRADE. `totalBet` and `totalPayout` are in the bet's currency
 * (`amount` is the coin part; an upgrade staking a skin has amount 0 and
 * totalBet the skin's value). `roll.value` and `target` are in hundredths
 * of a percent, `chance` in percent, `houseEdgePercent` as stated.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { knownCurrency, seen, SITE, usd, type RollUser } from "./site.js";

type DiceBet = {
  id: string;
  amount?: number;
  totalBet?: number;
  totalPayout?: number;
  won?: boolean;
  currency?: string;
  choice?: string;
  createdAt?: string;
  chance?: number;
  houseEdgePercent?: number;
  roll?: { value?: number } | null;
  target?: number;
  user?: RollUser;
  gameType?: string;
};

const GAME: Record<string, string> = { DICE: "dice", UPGRADE: "upgrader" };

export function handleDiceBets(payload: unknown, at: Date, ctx: AdapterContext) {
  const bets = (payload as { createDiceBets?: { diceBets?: DiceBet[] } })?.createDiceBets?.diceBets ?? [];
  for (const b of bets) {
    if (!b?.id) continue;
    const playerId = seen(b.user, at, ctx);
    if (!playerId) continue;
    const stake = Number(b.totalBet) || 0;
    const payout = Number(b.totalPayout) || 0;
    const placedAt = b.createdAt ? new Date(b.createdAt) : at;
    ctx.sink.bet({
      site: SITE,
      game: GAME[b.gameType ?? ""] ?? (b.gameType ? b.gameType.toLowerCase() : "dice"),
      externalId: b.id,
      roundId: null,
      playerId,
      wageredUsd: usd(stake, b.currency),
      payoutUsd: usd(payout, b.currency),
      won: b.won ?? payout > stake,
      placedAt,
      settledAt: placedAt,
      meta: {
        choice: b.choice ?? null,
        chance: b.chance ?? null,
        target: b.target ?? null,
        roll: b.roll?.value ?? null,
        houseEdgePercent: b.houseEdgePercent ?? null,
        coinAmount: b.amount ?? null,
        currency: b.currency ?? null,
        ...(knownCurrency(b.currency) ? {} : { currencyUnknown: true }),
      },
    });
  }
}
