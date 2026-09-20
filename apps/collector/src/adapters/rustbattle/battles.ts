/**
 * Case battles. `case-battles:store` announces a new lobby and
 * `case-battles:update` carries the whole battle on every change: teams
 * with their seats (`teams[].users[]`), the cases, every drop so far
 * (`caseOpens`, price in cents, keyed to a seat by `case_battle_team_user_id`)
 * and, once `status` is "ended", `team_winners` and each seat's `won`.
 *
 * Every seat pays `cost` (the sum of the case prices for all rounds). A
 * seat's payout is its `won`, which the site has already split between the
 * winning team's seats, so the row needs no formula of its own. Seats with
 * `bot = 1` are the house (one house player per bot identity).
 *
 * `borrow_money_amount` marks a seat the site lent money for: on the two
 * battles read on 2026-09-20 such a seat kept a third of its share and its
 * bot teammate the rest. The stake recorded is still the full `cost`, with
 * the loan noted in meta, until the site's own rule for it is confirmed.
 */
import type { AdapterContext } from "../../core/adapter.js";
import { type RbUser, SITE, seen, seenBot, usd } from "./site.js";

type RbSeat = {
  id: number;
  case_battle_team_id: number;
  user_uuid: string | null;
  bot: 0 | 1 | boolean;
  status?: string;
  won?: number | string | null;
  borrow_money_amount?: number | null;
  botIdentity?: { id?: number | null; name?: string | null; thumbnail?: string | null } | null;
  user?: RbUser | null;
};

export type RbBattle = {
  uuid: string;
  mode?: string;
  type?: string;
  status?: string;
  currency?: string;
  created_at?: string;
  updated_at?: string;
  cost?: number | string;
  total_amount?: number | string;
  rounds?: number;
  cursed_mode?: boolean;
  terminal_mode?: boolean;
  jackpot_mode?: boolean;
  duel_mode?: boolean;
  elimination_mode?: boolean;
  is_refunded?: boolean;
  team_winners?: number[];
  teams?: { id: number; users?: RbSeat[] }[];
  caseOpens?: { case_battle_team_user_id: number; price?: number | string }[];
};

export function battles() {
  const settled = new Set<string>();

  function onUpdate(b: RbBattle, receivedAt: Date, ctx: AdapterContext) {
    if (!b?.uuid || b.status !== "ended" || settled.has(b.uuid)) return;
    if (b.currency && b.currency !== "coins") return; // play money
    settled.add(b.uuid);
    if (settled.size > 5000) settled.delete(settled.values().next().value!);
    const cost = usd(b.cost ?? b.total_amount);
    const winners = new Set(b.team_winners ?? []);
    const drops = new Map<number, number>();
    for (const o of b.caseOpens ?? []) drops.set(o.case_battle_team_user_id, (drops.get(o.case_battle_team_user_id) ?? 0) + (Number(o.price) || 0));
    const placedAt = b.created_at ? new Date(b.created_at) : receivedAt;
    const settledAt = b.updated_at ? new Date(b.updated_at) : receivedAt;
    for (const team of b.teams ?? []) {
      for (const seat of team.users ?? []) {
        const house = seat.bot === 1 || seat.bot === true;
        const pid = house ? seenBot(seat.botIdentity, receivedAt, ctx) : seen(seat.user ?? { uuid: seat.user_uuid }, receivedAt, ctx);
        if (!pid) continue;
        const payout = b.is_refunded ? cost : usd(seat.won);
        ctx.sink.bet({
          site: SITE,
          game: "battles",
          externalId: `${b.uuid}:${seat.id}`,
          roundId: b.uuid,
          playerId: pid,
          isHouse: house,
          wageredUsd: cost,
          payoutUsd: payout,
          won: b.is_refunded ? null : winners.has(team.id),
          placedAt,
          settledAt,
          meta: {
            mode: b.mode, type: b.type, rounds: b.rounds, cursed: b.cursed_mode, terminal: b.terminal_mode, jackpot: b.jackpot_mode, duel: b.duel_mode, elimination: b.elimination_mode,
            team: team.id, seat: seat.id, unboxedUsd: usd(drops.get(seat.id) ?? 0), borrow: seat.borrow_money_amount || undefined, refunded: b.is_refunded || undefined,
          },
        });
      }
    }
  }

  return { onUpdate };
}
