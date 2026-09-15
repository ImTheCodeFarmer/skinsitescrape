/**
 * Case battles on Clash.gg, RustClash and Cases.gg share one legacy layout:
 * an events row per battle, a users row per *real* participant (bots are only
 * in the drops table), and the site's total payout to real players on the
 * event. Each real player wagers join_price; real players on the winning team
 * split amount_paid_to_users equally, which is how the legacy dashboard's own
 * stats functions computed it.
 *
 * winning_team is only set when a real player won. A finished battle with a
 * null winning_team (rounds exist, nothing paid) is one the bots won, so every
 * real player lost their stake. Rows with no rounds yet are unfinished and
 * are left for a later run. Only currency = 'REAL' counts; PLAY and BON are
 * play/bonus money and were excluded by the legacy dashboard too.
 */
import { LEGACY_META, date, groupBy, moneyFor, num, round4 } from "../config.js";
import { profiles } from "../profiles.js";
import type { Row, Source } from "../types.js";

type Cfg = {
  name: string;
  site: string;
  events: string;
  users: string;
  rounds: string;
  userCol: string;
  profiles: string;
  /** Column holding the site's total payout to real users, and whether it is in site units or USD. */
  paid: { col: string; unit: "site" | "usd" };
};

export function clashFamilyBattles(cfg: Cfg): Source {
  const usd = moneyFor(cfg.site);
  const paidUsd = cfg.paid.unit === "usd" ? (v: unknown) => round4(num(v)) : usd;
  return {
    name: cfg.name,
    site: cfg.site,
    table: cfg.events,
    where: "currency = 'REAL' AND internal_id IS NOT NULL",
    cutoffs: { bets: { table: "bets", col: "placed_at", game: "battles" } },
    async handle(rows, ctx) {
      const ids = rows.map((r) => String(r.id));
      const users = (await ctx.legacy.unsafe(
        `SELECT case_battle_event_id AS eid, ${cfg.userCol} AS uid, team FROM ${cfg.users}
         WHERE case_battle_event_id = ANY($1::bigint[]) AND ${cfg.userCol} IS NOT NULL`,
        [ids],
      )) as unknown as Row[];
      const byEvent = groupBy(users, "eid");
      const finished = new Set(
        ((await ctx.legacy.unsafe(`SELECT DISTINCT case_battle_event_id AS eid FROM ${cfg.rounds} WHERE case_battle_event_id = ANY($1::bigint[])`, [ids])) as unknown as Row[]).map((r) => String(r.eid)),
      );
      const profile = await profiles(ctx, cfg.profiles, "id, NULL AS ext, display_name AS name, avatar");
      const cutoff = ctx.cutoffs.bets;

      for (const e of rows) {
        const placedAt = date(e.game_created_at) ?? date(e.created_at)!;
        if (cutoff && placedAt >= cutoff) {
          ctx.stats.skipped++;
          continue;
        }
        const players = byEvent.get(String(e.id)) ?? [];
        if (!players.length || !finished.has(String(e.id))) {
          ctx.stats.skipped++;
          continue;
        }
        const roundId = String(e.internal_id);
        const settledAt = date(e.updated_at) ?? placedAt;
        const winningTeam = e.winning_team == null ? -1 : num(e.winning_team);
        const winners = players.filter((p) => num(p.team) === winningTeam);
        const perWinner = winners.length ? round4(paidUsd(e[cfg.paid.col]) / winners.length) : 0;
        const wager = usd(e.join_price);
        for (const p of players) {
          const uid = String(p.uid);
          const prof = profile.get(uid);
          ctx.sink.player({ site: cfg.site, externalId: uid, displayName: prof?.name, avatar: prof?.avatar, seenAt: placedAt });
          const won = num(p.team) === winningTeam;
          ctx.sink.bet({
            site: cfg.site,
            game: "battles",
            externalId: `${roundId}:${uid}:${num(p.team)}`,
            roundId,
            playerId: uid,
            wageredUsd: wager,
            payoutUsd: won ? perWinner : 0,
            won,
            placedAt,
            settledAt,
            meta: LEGACY_META,
          });
        }
        ctx.stats.emitted++;
      }
    },
  };
}

export const clashBattles = clashFamilyBattles({
  name: "clash-battles",
  site: "clash",
  events: "clash_case_battle_events",
  users: "clash_case_battle_events_users",
  rounds: "clash_case_battle_event_rounds",
  userCol: "clash_user_id",
  profiles: "clash_users",
  paid: { col: "amount_paid_to_users_coins", unit: "site" },
});

export const rustclashBattles = clashFamilyBattles({
  name: "rustclash-battles",
  site: "rustclash",
  events: "rust_clash_case_battle_events",
  users: "rust_clash_case_battle_events_users",
  rounds: "rust_clash_case_battle_event_rounds",
  userCol: "rust_clash_user_id",
  profiles: "rust_clash_users",
  paid: { col: "amount_paid_to_users_coins", unit: "site" },
});

export const casesBattles = clashFamilyBattles({
  name: "cases-battles",
  site: "cases",
  events: "casesgg_case_battle_events",
  users: "casesgg_case_battle_events_users",
  rounds: "casesgg_case_battle_event_rounds",
  userCol: "casesgg_user_id",
  profiles: "casesgg_users",
  paid: { col: "amount_paid_to_users_dollars", unit: "usd" },
});
