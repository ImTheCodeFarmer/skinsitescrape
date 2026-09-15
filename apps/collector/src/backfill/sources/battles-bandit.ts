/**
 * Bandit.camp and RustMagic battles (same scraper, same layout). Neither site
 * is on the dashboard yet, so both are opt-in.
 *
 * Bandit: winning_team is a JSON array of team ids and total_won is the whole
 * pot; every seat on a winning team (bots too) takes an equal share, and only
 * the real seats become bets. This is the legacy calculate_bandit_battle_profit
 * rule.
 *
 * RustMagic: winning_team was never populated. total_earned is what real
 * players staked and total_paid what real players received. With one real
 * player that is exact; with several, the payout is split evenly and the bet
 * is flagged unattributed because the winner is unknown.
 */
import { LEGACY_META, date, groupBy, moneyFor, num, round4, str } from "../config.js";
import { extId, profiles, type Profile } from "../profiles.js";
import type { Row, Source, SourceCtx } from "../types.js";

type Cfg = { name: string; site: string; prefix: "bandit" | "rustmagic"; note: string };

function make(cfg: Cfg): Source {
  const usd = moneyFor(cfg.site);
  const battles = `${cfg.prefix}_case_battles`;
  const users = `${cfg.prefix}_case_battles_users`;
  const profilesT = `${cfg.prefix}_users`;
  const fkBattle = `${cfg.prefix}_case_battles_id`;
  const fkUser = `${cfg.prefix}_users_id`;

  return {
    name: cfg.name,
    site: cfg.site,
    table: battles,
    where: "status = 2",
    optIn: true,
    note: cfg.note,
    cutoffs: { bets: { table: "bets", col: "placed_at", game: "battles" } },
    async handle(rows, ctx) {
      const ids = rows.map((r) => String(r.id));
      const seats = (await ctx.legacy.unsafe(
        `SELECT ${fkBattle} AS bid, ${fkUser} AS uid, is_bot, team FROM ${users} WHERE ${fkBattle} = ANY($1::int[])`,
        [ids],
      )) as unknown as Row[];
      const bySeat = groupBy(seats, "bid");
      const profile = await profiles(ctx, profilesT, "id, internal_id AS ext, name, avatar");
      for (const b of rows) {
        const all = bySeat.get(String(b.id)) ?? [];
        const real = all.filter((s) => !s.is_bot && s.uid != null);
        if (!real.length) {
          ctx.stats.skipped++;
          continue;
        }
        const placedAt = date(b.created_at)!;
        if (ctx.cutoffs.bets && placedAt >= ctx.cutoffs.bets) {
          ctx.stats.skipped++;
          continue;
        }
        if (cfg.prefix === "bandit") bandit(b, all, real, profile, usd, ctx);
        else rustmagic(b, real, profile, usd, ctx);
        ctx.stats.emitted++;
      }
    },
  };

  function emit(ctx: SourceCtx, b: Row, seat: Row, profile: Map<string, Profile>, bet: { wagered: number; payout: number; won: boolean | null; attributed: boolean }, placedAt: Date) {
    const prof = profile.get(String(seat.uid));
    const externalId = extId(profile, seat.uid);
    ctx.sink.player({ site: cfg.site, externalId, displayName: prof?.name, avatar: prof?.avatar, seenAt: placedAt });
    const roundId = str(b.internal_id) ?? `legacy:${b.id}`;
    ctx.sink.bet({
      site: cfg.site,
      game: "battles",
      externalId: `${roundId}:${externalId}:${num(seat.team)}`,
      roundId,
      playerId: externalId,
      wageredUsd: bet.wagered,
      payoutUsd: bet.payout,
      won: bet.won,
      placedAt,
      settledAt: date(b.updated_at) ?? placedAt,
      meta: bet.attributed ? LEGACY_META : { ...LEGACY_META, attributed: false },
    });
  }

  function bandit(b: Row, all: Row[], real: Row[], profile: Map<string, Profile>, usd: (v: unknown) => number, ctx: SourceCtx) {
    const winning = new Set<number>(Array.isArray(b.winning_team) ? b.winning_team.map(num) : []);
    const winningSeats = all.filter((s) => winning.has(num(s.team))).length;
    const share = winningSeats ? round4(usd(b.total_won) / winningSeats) : 0;
    const placedAt = date(b.created_at)!;
    for (const s of real) {
      const won = winning.has(num(s.team));
      emit(ctx, b, s, profile, { wagered: usd(b.price), payout: won ? share : 0, won, attributed: true }, placedAt);
    }
  }

  function rustmagic(b: Row, real: Row[], profile: Map<string, Profile>, usd: (v: unknown) => number, ctx: SourceCtx) {
    const earned = b.total_earned != null ? usd(b.total_earned) : round4(usd(b.price) * real.length);
    const paid = usd(b.total_paid);
    const wagered = round4(earned / real.length);
    const placedAt = date(b.created_at)!;
    for (const s of real) {
      const single = real.length === 1;
      emit(
        ctx,
        b,
        s,
        profile,
        { wagered, payout: round4(paid / real.length), won: single ? paid > 0 : paid > 0 ? null : false, attributed: single || paid === 0 },
        placedAt,
      );
    }
  }
}

export const banditBattles = make({ name: "banditcamp-battles", site: "banditcamp", prefix: "bandit", note: "site not on the dashboard; unit scale assumed (cents)" });
export const rustmagicBattles = make({ name: "rustmagic-battles", site: "rustmagic", prefix: "rustmagic", note: "site not on the dashboard; total_earned/total_paid units do not reconcile with price, so amounts are unverified; winner unknown when several real players" });
