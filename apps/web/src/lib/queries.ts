import "server-only";
import { sql } from "@casino/db";
import { db } from "./db";
import { CASINOS, gameLabel, getCasinoMeta } from "./casinos";
import { memo, ttlFor } from "./memo";
import type { Account, AccountStats, BetRow, SteamProfile, CoinflipRound, GameStat, Highlight, Highlights, JackpotRound, LinkEvidence, LinkedAccount, PlayerPoint, PlayerProfile, PlayerStat, PlayerTotals, Point, ProfitBreakdown, Range, SiteCard, SiteGameInfo, SiteStatus, Summary } from "./types";

/** Whether a site has coinflip / jackpot detail (rounds tables, breakdown, pot records). */
const hasPots = (site: string) => Boolean(getCasinoMeta(site)?.pots);

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const rows = async (q: ReturnType<typeof sql>) => (await db().execute(q)) as unknown as Row[];

export function parseRange(v: string | string[] | undefined): Range {
  const r = Number(Array.isArray(v) ? v[0] : v);
  return r === 1 || r === 7 || r === 30 || r === 90 ? r : 7;
}

/** Sites that have a collector row, i.e. real data. */
export async function trackedSites(): Promise<string[]> {
  const r = await rows(sql`SELECT DISTINCT site FROM bets_daily UNION SELECT site FROM collector_status`);
  return r.map((x) => String(x.site));
}

/** Admin site info: every game each site has bets for, with its volume and first and last day, from the daily rollup. */
export async function siteGames(): Promise<Record<string, SiteGameInfo[]>> {
  const r = await rows(sql`SELECT site, game, sum(bets) bets, min(bucket) first_day, max(bucket) last_day FROM bets_daily GROUP BY site, game ORDER BY site, bets DESC`);
  const out: Record<string, SiteGameInfo[]> = {};
  for (const x of r) {
    (out[String(x.site)] ??= []).push({
      game: String(x.game),
      label: gameLabel(String(x.game)),
      bets: n(x.bets),
      firstDay: new Date(x.first_day as string).toISOString(),
      lastDay: new Date(x.last_day as string).toISOString(),
    });
  }
  return out;
}

export async function statuses(): Promise<Record<string, SiteStatus>> {
  const r = await rows(sql`SELECT site, connected, last_event_at, last_connect_at, reconnects FROM collector_status`);
  return Object.fromEntries(
    r.map((x) => [
      String(x.site),
      {
        site: String(x.site),
        connected: Boolean(x.connected),
        lastEventAt: x.last_event_at ? new Date(x.last_event_at as string).toISOString() : null,
        lastConnectAt: x.last_connect_at ? new Date(x.last_connect_at as string).toISOString() : null,
        reconnects: n(x.reconnects),
      },
    ]),
  );
}

/**
 * Window for a range. 24h is a rolling window of hourly buckets; longer
 * ranges are whole UTC days ending today, so they line up with the daily
 * continuous aggregates. Completed days come out of the materialized rows and
 * only today is computed live, which keeps these queries cheap no matter how
 * much history sits behind them.
 */
function window(range: Range, offsetWindows = 0) {
  if (range === 1) {
    const hours = 24;
    return {
      from: sql`now() - make_interval(hours => ${hours * (offsetWindows + 1)})`,
      to: sql`now() - make_interval(hours => ${hours * offsetWindows})`,
    };
  }
  return {
    from: sql`(now()::date - ${range * (offsetWindows + 1) - 1}::int)::timestamptz`,
    to: sql`(now()::date - ${range * offsetWindows - 1}::int)::timestamptz`,
  };
}

/** Time series for one site (or all sites when `site` is null). */
export async function series(site: string | null, range: Range, offsetWindows = 0): Promise<Point[]> {
  const { from, to } = window(range, offsetWindows);
  return seriesBetween(site, range === 1, from, to);
}

/**
 * The buckets still moving: the current and previous hour (24h view) or
 * today and yesterday (daily views). Everything older is settled and the
 * client keeps it from the initial render.
 */
export async function seriesTail(site: string | null, range: Range): Promise<Point[]> {
  return range === 1
    ? seriesBetween(site, true, sql`date_trunc('hour', now()) - interval '1 hour'`, sql`now() + interval '1 hour'`)
    : seriesBetween(site, false, sql`(now()::date - 1)::timestamptz`, sql`(now()::date + 1)::timestamptz`);
}

async function seriesBetween(site: string | null, hourly: boolean, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>): Promise<Point[]> {
  const siteFilter = site ? sql`AND site = ${site}` : sql``;
  const r =
    hourly
      ? await rows(sql`
          SELECT bucket AS t, sum(wagered_usd) wagered, sum(house_net_usd) net, sum(players) players, sum(bets) bets
          FROM bets_hourly WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}
          GROUP BY bucket ORDER BY bucket`)
      : await rows(sql`
          WITH d AS (
            SELECT bucket, sum(wagered_usd) wagered, sum(house_net_usd) net, sum(bets) bets
            FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter} GROUP BY bucket),
          p AS (
            SELECT bucket, count(DISTINCT player_id) players
            FROM player_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter} GROUP BY bucket)
          SELECT d.bucket AS t, d.wagered, d.net, coalesce(p.players, 0) players, d.bets
          FROM d LEFT JOIN p ON p.bucket = d.bucket ORDER BY d.bucket`);
  return r.map((x) => ({ t: new Date(x.t as string).toISOString(), wagered: n(x.wagered), net: n(x.net), players: n(x.players), bets: n(x.bets) }));
}

async function totals(site: string | null, range: Range, offsetWindows = 0) {
  const { from, to } = window(range, offsetWindows);
  const siteFilter = site ? sql`AND site = ${site}` : sql``;
  const [r] =
    range === 1
      ? await rows(sql`
          SELECT coalesce(sum(wagered_usd),0) wagered, coalesce(sum(payout_usd),0) payout,
                 count(DISTINCT player_id) players, count(*) bets,
                 coalesce(sum(payout_usd - wagered_usd) FILTER (WHERE won), 0) won_profit,
                 coalesce(sum(wagered_usd) FILTER (WHERE NOT coalesce(won, false)), 0) lost_wagered
          FROM bets WHERE settled_at IS NOT NULL AND NOT is_house
            AND placed_at >= ${from} AND placed_at < ${to} ${siteFilter}`)
      : await rows(sql`
          SELECT coalesce((SELECT sum(wagered_usd) FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) wagered,
                 coalesce((SELECT sum(payout_usd)  FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) payout,
                 coalesce((SELECT sum(bets)        FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) bets,
                 coalesce((SELECT sum(won_profit_usd)   FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) won_profit,
                 coalesce((SELECT sum(lost_wagered_usd) FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) lost_wagered,
                 (SELECT count(DISTINCT player_id) FROM player_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}) players`);
  return { wagered: n(r?.wagered), payout: n(r?.payout), players: n(r?.players), bets: n(r?.bets), playerWins: n(r?.won_profit), playerLosses: n(r?.lost_wagered) };
}

export async function summary(site: string | null, range: Range): Promise<Summary> {
  const [cur, prev, pts] = await Promise.all([totals(site, range, 0), totals(site, range, 1), series(site, range)]);
  const net = cur.wagered - cur.payout;
  const prevNet = prev.wagered - prev.payout;
  return {
    wagered: cur.wagered,
    payout: cur.payout,
    profit: pts.reduce((a, p) => a + Math.max(0, p.net), 0),
    loss: pts.reduce((a, p) => a + Math.max(0, -p.net), 0),
    net,
    players: cur.players,
    bets: cur.bets,
    playerWins: cur.playerWins,
    playerLosses: cur.playerLosses,
    rtp: cur.wagered ? (cur.payout / cur.wagered) * 100 : 0,
    deltaWager: prev.wagered ? (cur.wagered - prev.wagered) / prev.wagered : null,
    deltaNet: prevNet ? (net - prevNet) / Math.abs(prevNet) : null,
  };
}

export async function topGames(site: string | null, range: Range): Promise<GameStat[]> {
  const { from, to } = window(range);
  const siteFilter = site ? sql`AND site = ${site}` : sql``;
  const r =
    range === 1
      ? await rows(sql`
          SELECT game, sum(wagered_usd) wagered, count(*) plays, sum(wagered_usd - payout_usd) net
          FROM bets WHERE settled_at IS NOT NULL AND NOT is_house AND placed_at >= ${from} AND placed_at < ${to} ${siteFilter}
          GROUP BY game ORDER BY wagered DESC`)
      : await rows(sql`
          SELECT game, sum(wagered_usd) wagered, sum(bets) plays, sum(house_net_usd) net
          FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}
          GROUP BY game ORDER BY wagered DESC`);
  return r.map((x) => ({ name: gameLabel(String(x.game)), wagered: n(x.wagered), plays: n(x.plays), net: n(x.net) }));
}

export async function topPlayers(site: string | null, range: Range, limit = 10): Promise<(PlayerStat & { site: string })[]> {
  const { from, to } = window(range);
  const siteFilter = site ? sql`AND b.site = ${site}` : sql``;
  const r =
    range === 1
      ? await rows(sql`
          WITH agg AS (
            SELECT b.site, b.player_id, sum(wagered_usd) wagered, sum(payout_usd - wagered_usd) net, count(*) bets,
                   count(DISTINCT date_trunc('day', placed_at)) active_days,
                   mode() WITHIN GROUP (ORDER BY game) favorite
            FROM bets b WHERE settled_at IS NOT NULL AND NOT is_house
              AND placed_at >= ${from} AND placed_at < ${to} ${siteFilter}
            GROUP BY b.site, b.player_id ORDER BY wagered DESC LIMIT ${limit})
          SELECT agg.*, p.display_name, p.avatar FROM agg
          LEFT JOIN players p ON p.site = agg.site AND p.external_id = agg.player_id
          ORDER BY wagered DESC`)
      : await rows(sql`
          WITH agg AS (
            SELECT b.site, b.player_id, sum(wagered_usd) wagered, sum(payout_usd - wagered_usd) net, sum(bets) bets,
                   count(DISTINCT bucket) active_days,
                   (array_agg(game ORDER BY wagered_usd DESC))[1] favorite
            FROM player_daily b WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}
            GROUP BY b.site, b.player_id ORDER BY wagered DESC LIMIT ${limit})
          SELECT agg.*, p.display_name, p.avatar FROM agg
          LEFT JOIN players p ON p.site = agg.site AND p.external_id = agg.player_id
          ORDER BY wagered DESC`);
  return r.map((x) => ({
    site: String(x.site),
    id: String(x.player_id),
    handle: (x.display_name as string) ?? String(x.player_id),
    avatar: (x.avatar as string) ?? null,
    wagered: n(x.wagered),
    net: n(x.net),
    bets: n(x.bets),
    favorite: gameLabel(String(x.favorite ?? "")),
    activeDays: n(x.active_days),
  }));
}

/** Last 14 days of daily wager for a sidebar sparkline. */
async function sparkline(site: string): Promise<number[]> {
  const r = await rows(sql`
    SELECT d::date AS day, coalesce(sum(wagered_usd), 0) w
    FROM generate_series(now()::date - 13, now()::date, '1 day') d
    LEFT JOIN bets_daily b ON b.bucket::date = d::date AND b.site = ${site}
    GROUP BY 1 ORDER BY 1`);
  return r.map((x) => n(x.w));
}

/** Every site we intend to track, with stats for the ones that have a collector. */
export async function siteCards(range: Range): Promise<SiteCard[]> {
  const [tracked, st] = await Promise.all([trackedSites(), statuses()]);
  return Promise.all(
    CASINOS.map(async (meta) => {
      const isTracked = tracked.includes(meta.slug);
      if (!isTracked) return { meta, tracked: false, summary: null, spark: [], status: null };
      const [s, spark] = await Promise.all([summary(meta.slug, range), sparkline(meta.slug)]);
      return { meta, tracked: true, summary: s, spark, status: st[meta.slug] ?? null };
    }),
  );
}

const str = (v: unknown) => (v == null ? null : String(v));

export const recentCoinflips = (site: string, range: Range, limit = 25) => memo(`flips:${site}:${range}:${limit}`, ttlFor(range), () => recentCoinflipsQuery(site, range, limit));
/** Rounds settled after `since`, newest first. Uncached: it is the live tail. */
export const roundsSince = async (site: string, range: Range, since: string, limit = 25) => {
  const [flips, pots] = await Promise.all([recentCoinflipsQuery(site, range, limit, since), recentJackpotsQuery(site, range, limit, since)]);
  return { flips, pots };
};
async function recentCoinflipsQuery(site: string, range: Range, limit: number, since?: string): Promise<CoinflipRound[]> {
  const hours = range === 1 ? 24 : range * 24;
  const sinceFilter = since ? sql`AND c.settled_at > ${since}::timestamptz` : sql``;
  const r = await rows(sql`
    SELECT c.external_id, c.created_at, c.settled_at, c.status, c.creator_id, c.creator_pick, c.creator_total,
           c.opponent_id, c.opponent_total, c.winner_id, c.winning_side, c.pot_usd, c.tax_usd, c.house_net_usd,
           pc.display_name creator_name, pc.avatar creator_avatar, coalesce(pc.is_house, false) creator_house,
           po.display_name opponent_name, po.avatar opponent_avatar, coalesce(po.is_house, false) opponent_house
    FROM coinflips c
    LEFT JOIN players pc ON pc.site = c.site AND pc.external_id = c.creator_id
    LEFT JOIN players po ON po.site = c.site AND po.external_id = c.opponent_id
    WHERE c.site = ${site} AND c.status = 'Ended' AND c.settled_at >= now() - make_interval(hours => ${hours}) ${sinceFilter}
    ORDER BY c.settled_at DESC LIMIT ${limit}`);
  return r.map((x) => ({
    id: String(x.external_id),
    createdAt: new Date(x.created_at as string).toISOString(),
    settledAt: x.settled_at ? new Date(x.settled_at as string).toISOString() : null,
    status: String(x.status),
    creator: { id: String(x.creator_id), name: str(x.creator_name) ?? String(x.creator_id), avatar: str(x.creator_avatar), house: Boolean(x.creator_house), total: n(x.creator_total), pick: x.creator_pick == null ? null : n(x.creator_pick) },
    opponent: x.opponent_id ? { id: String(x.opponent_id), name: str(x.opponent_name) ?? String(x.opponent_id), avatar: str(x.opponent_avatar), house: Boolean(x.opponent_house), total: n(x.opponent_total) } : null,
    winnerId: str(x.winner_id),
    winningSide: x.winning_side == null ? null : n(x.winning_side),
    pot: n(x.pot_usd),
    tax: x.tax_usd == null ? null : n(x.tax_usd),
    houseNet: x.house_net_usd == null ? null : n(x.house_net_usd),
  }));
}

export const recentJackpots = (site: string, range: Range, limit = 25) => memo(`pots:${site}:${range}:${limit}`, ttlFor(range), () => recentJackpotsQuery(site, range, limit));
async function recentJackpotsQuery(site: string, range: Range, limit: number, since?: string): Promise<JackpotRound[]> {
  const hours = range === 1 ? 24 : range * 24;
  const sinceFilter = since ? sql`AND j.settled_at > ${since}::timestamptz` : sql``;
  const r = await rows(sql`
    SELECT j.external_id, j.created_at, j.settled_at, j.pot_usd, j.entries, j.winner_id, j.winner_ticket, j.tax_usd, j.house_net_usd,
           j.meta->>'winnerChance' winner_chance, coalesce((j.meta->>'partial')::boolean, false) partial, j.meta->>'winnerName' winner_name_meta,
           p.display_name winner_name, p.avatar winner_avatar
    FROM jackpots j
    LEFT JOIN players p ON p.site = j.site AND p.external_id = j.winner_id
    WHERE j.site = ${site} AND j.status = 'Ended' AND j.pot_usd IS NOT NULL AND j.settled_at >= now() - make_interval(hours => ${hours}) ${sinceFilter}
    ORDER BY j.settled_at DESC LIMIT ${limit}`);
  return r.map((x) => ({
    id: String(x.external_id),
    createdAt: new Date(x.created_at as string).toISOString(),
    settledAt: x.settled_at ? new Date(x.settled_at as string).toISOString() : null,
    pot: n(x.pot_usd),
    entries: n(x.entries),
    winner: x.winner_id || x.winner_name_meta ? { id: str(x.winner_id) ?? "", name: str(x.winner_name) ?? str(x.winner_name_meta) ?? "", avatar: str(x.winner_avatar) } : null,
    winnerChance: x.winner_chance == null ? null : n(x.winner_chance),
    ticket: x.winner_ticket == null ? null : n(x.winner_ticket),
    tax: x.tax_usd == null ? null : n(x.tax_usd),
    houseNet: x.house_net_usd == null ? null : n(x.house_net_usd),
    partial: Boolean(x.partial),
  }));
}

const iso = (v: unknown) => new Date(v as string).toISOString();

/**
 * Settled bets by real players, newest first. Bets by admin-marked players
 * (stored with is_house, see lib/admin-players.ts) are hidden like the
 * bots' unless `showAdmin`, which the pages set for dashboard admins; the
 * rows then carry the mark.
 */
export const recentBets = (site: string, range: Range, showAdmin = false, limit = 25) => memo(`bets:${site}:${range}:${limit}:${showAdmin ? "admin" : "public"}`, ttlFor(range), () => recentBetsQuery(site, range, limit, showAdmin));
/** Bets settled after `since`, newest first. Uncached: it is the live tail. */
export const betsSince = (site: string, range: Range, since: string, showAdmin = false, limit = 25) => recentBetsQuery(site, range, limit, showAdmin, since);
async function recentBetsQuery(site: string, range: Range, limit: number, showAdmin: boolean, since?: string): Promise<BetRow[]> {
  const hours = range === 1 ? 24 : range * 24;
  const sinceFilter = since ? sql`AND b.settled_at > ${since}::timestamptz` : sql``;
  const houseFilter = showAdmin ? sql`(NOT b.is_house OR p.is_admin)` : sql`NOT b.is_house`;
  const r = await rows(sql`
    SELECT b.game, b.external_id, b.round_id, b.player_id, b.placed_at, b.settled_at, b.wagered_usd, b.payout_usd, b.won, p.display_name, p.avatar, p.is_admin
    FROM bets b LEFT JOIN players p ON p.site = b.site AND p.external_id = b.player_id
    WHERE b.site = ${site} AND ${houseFilter} AND b.settled_at IS NOT NULL
      AND b.placed_at >= now() - make_interval(hours => ${hours}) - interval '1 day' AND b.settled_at >= now() - make_interval(hours => ${hours}) ${sinceFilter}
    ORDER BY b.settled_at DESC LIMIT ${limit}`);
  return r.map((x) => ({
    id: `${x.game}:${x.external_id}`,
    game: String(x.game),
    roundId: str(x.round_id),
    placedAt: iso(x.placed_at),
    settledAt: iso(x.settled_at),
    player: { id: String(x.player_id), name: str(x.display_name) ?? String(x.player_id), avatar: str(x.avatar), ...(showAdmin ? { admin: Boolean(x.is_admin) } : {}) },
    wagered: n(x.wagered_usd),
    payout: n(x.payout_usd),
    won: x.won == null ? null : Boolean(x.won),
  }));
}

/**
 * Profit breakdown. Long ranges sum the daily aggregates (a row per day);
 * the 24h view sums the day's rounds directly. For a flip the house played,
 * house_net_usd already nets tax and the bot's stake, so bot = house_net -
 * tax, split into flips the bot won and flips it lost; flips between two
 * real players contribute tax only. Jackpot rake comes from the jackpots
 * side so legacy rounds (which have no bets rows) still count.
 */
export const profitBreakdown = (site: string, range: Range) => memo(`breakdown:${site}:${range}`, ttlFor(range), () => profitBreakdownQuery(site, range));
async function profitBreakdownQuery(site: string, range: Range): Promise<ProfitBreakdown> {
  const { from, to } = window(range);
  const [[c], [j]] =
    range === 1
      ? await Promise.all([
          rows(sql`
            SELECT coalesce(sum(tax_usd), 0) flip_tax,
                   coalesce(sum(house_net_usd - coalesce(tax_usd, 0)) FILTER (WHERE house_involved AND winner_house), 0) bot_wins,
                   coalesce(sum(house_net_usd - coalesce(tax_usd, 0)) FILTER (WHERE house_involved AND NOT winner_house), 0) bot_losses,
                   count(*) FILTER (WHERE house_involved) house_flips,
                   coalesce(bool_or((meta->>'taxEstimated')::boolean), false) estimated
            FROM coinflips WHERE site = ${site} AND status = 'Ended' AND created_at >= ${from} AND created_at < ${to}`),
          rows(sql`
            SELECT coalesce(sum(tax_usd), 0) jackpot_tax, coalesce(bool_or((meta->>'taxEstimated')::boolean), false) estimated
            FROM jackpots WHERE site = ${site} AND status = 'Ended' AND created_at >= ${from} AND created_at < ${to}`),
        ])
      : await Promise.all([
          rows(sql`
            SELECT coalesce(sum(tax_usd), 0) flip_tax, coalesce(sum(bot_wins), 0) bot_wins, coalesce(sum(bot_losses), 0) bot_losses,
                   coalesce(sum(house_flips), 0) house_flips, coalesce(bool_or(estimated), false) estimated
            FROM flips_daily WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`),
          rows(sql`
            SELECT coalesce(sum(tax_usd), 0) jackpot_tax, coalesce(bool_or(estimated), false) estimated
            FROM jackpots_daily WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`),
        ]);
  const botWins = n(c?.bot_wins);
  const botLosses = n(c?.bot_losses);
  const flipTax = n(c?.flip_tax);
  const jackpotTax = n(j?.jackpot_tax);
  return { botWins, botLosses, flipTax, jackpotTax, total: botWins + botLosses + flipTax + jackpotTax, houseFlips: n(c?.house_flips), estimated: Boolean(c?.estimated) || Boolean(j?.estimated) };
}

const who = (name: unknown, id: unknown, avatar: unknown, house: unknown) => ({ name: str(name) ?? String(id ?? "?"), avatar: str(avatar), house: Boolean(house) });
const moneyForCaption = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
const staked = (v: unknown) => ` · staked ${moneyForCaption(n(v))}`;
const chance = (v: unknown) => (v == null ? "" : ` at ${n(v).toFixed(n(v) < 10 ? 1 : 0)}% chance`);
const DAY_MS = 86_400_000;
// Bound as ISO strings: the driver cannot type a Date parameter behind an explicit cast.
const dayStart = (d: unknown) => new Date(d as string).toISOString();
const dayAfter = (d: unknown) => new Date(new Date(d as string).getTime() + DAY_MS).toISOString();

const flipSelect = sql`
  SELECT c.external_id, c.settled_at, c.created_at, c.pot_usd, c.tax_usd, c.house_net_usd, c.winner_id, c.winner_house, c.creator_id, c.opponent_id,
         c.creator_total, c.opponent_total,
         pc.display_name creator_name, pc.avatar creator_avatar, coalesce(pc.is_house, false) creator_house,
         po.display_name opponent_name, po.avatar opponent_avatar, coalesce(po.is_house, false) opponent_house
  FROM coinflips c
  LEFT JOIN players pc ON pc.site = c.site AND pc.external_id = c.creator_id
  LEFT JOIN players po ON po.site = c.site AND po.external_id = c.opponent_id`;
/** Gross the house received from a flip: the whole pot when its bot won, otherwise just the tax. */
const houseGross = sql`CASE WHEN c.winner_house THEN c.pot_usd ELSE c.tax_usd END`;

const jackpotSelect = sql`
  SELECT j.external_id, j.settled_at, j.created_at, j.pot_usd, j.tax_usd, j.winner_id, j.winner_house, (j.meta->>'winnerChance')::numeric winner_chance,
         j.meta->>'winnerName' winner_name_meta, p.display_name winner_name, p.avatar winner_avatar
  FROM jackpots j LEFT JOIN players p ON p.site = j.site AND p.external_id = j.winner_id`;
const jackpotGross = sql`CASE WHEN j.winner_house THEN j.pot_usd ELSE j.tax_usd END`;
const jackpotWinner = (x: Row) => who(x.winner_name ?? x.winner_name_meta, x.winner_id ?? "?", x.winner_avatar, Boolean(x.winner_house));

function flipHighlight(x: Row, amount: number, suffix = ""): Highlight {
  const creator = who(x.creator_name, x.creator_id, x.creator_avatar, x.creator_house);
  const opponent = who(x.opponent_name, x.opponent_id, x.opponent_avatar, x.opponent_house);
  const creatorWon = str(x.winner_id) === str(x.creator_id);
  const [winner, loser] = creatorWon ? [creator, opponent] : [opponent, creator];
  return { amount, at: iso(x.settled_at ?? x.created_at), game: "coinflip", roundId: String(x.external_id), caption: `${winner.name} beat ${loser.name}${suffix}`, players: [creator, opponent] };
}

function jackpotHighlight(x: Row, amount: number, caption: string): Highlight {
  const winner = jackpotWinner(x);
  return { amount, at: iso(x.settled_at ?? x.created_at), game: "jackpot", roundId: String(x.external_id), caption, players: [winner] };
}

/** The raw rows behind each record: whichever round holds the extreme value in the given time span. */
type RecordRows = {
  flip: Row | undefined;
  playerWin: Row | undefined;
  playerLoss: Row | undefined;
  houseFlip: Row | undefined;
  houseJackpot: Row | undefined;
  jackpot: Row | undefined;
  longShot: Row | undefined;
  streak: Row | undefined;
  botLoss: Row | undefined;
  peak: Row | undefined;
};

/** 24h: one day of rounds, scanned directly. */
const betSelect = sql`
  SELECT b.game, b.round_id, b.player_id, b.settled_at, b.placed_at, b.payout_usd, b.wagered_usd, p.display_name, p.avatar
  FROM bets b LEFT JOIN players p ON p.site = b.site AND p.external_id = b.player_id`;
const none = async (): Promise<Row[]> => [];

/** 24h: one day of rounds, scanned directly. Pot queries only run for sites that have pot games. */
async function recordRowsDirect(site: string, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>): Promise<RecordRows> {
  const pots = hasPots(site);
  const flipsIn = sql`WHERE c.site = ${site} AND c.status = 'Ended' AND c.created_at >= ${from} AND c.created_at < ${to}`;
  const potsIn = sql`WHERE j.site = ${site} AND j.status = 'Ended' AND j.created_at >= ${from} AND j.created_at < ${to}`;
  const betsIn = sql`WHERE b.site = ${site} AND NOT b.is_house AND b.settled_at IS NOT NULL AND b.placed_at >= ${from} AND b.placed_at < ${to}`;
  const [[flip], [playerWin], [playerLoss], [houseFlip], [houseJackpot], [jackpot], [longShot], [streak], [botLoss], [peak]] = await Promise.all([
    pots ? rows(sql`${flipSelect} ${flipsIn} ORDER BY c.pot_usd DESC NULLS LAST LIMIT 1`) : none(),
    rows(sql`${betSelect} ${betsIn} ORDER BY b.payout_usd DESC LIMIT 1`),
    rows(sql`${betSelect} ${betsIn} AND NOT coalesce(b.won, false) ORDER BY b.wagered_usd DESC LIMIT 1`),
    pots ? rows(sql`${flipSelect} ${flipsIn} ORDER BY ${houseGross} DESC NULLS LAST LIMIT 1`) : none(),
    pots ? rows(sql`${jackpotSelect} ${potsIn} ORDER BY ${jackpotGross} DESC NULLS LAST LIMIT 1`) : none(),
    pots ? rows(sql`${jackpotSelect} ${potsIn} ORDER BY j.pot_usd DESC NULLS LAST LIMIT 1`) : none(),
    pots ? rows(sql`${jackpotSelect} ${potsIn} AND (j.meta->>'winnerChance')::numeric > 0 AND j.pot_usd >= 25 ORDER BY (j.meta->>'winnerChance')::numeric ASC, j.pot_usd DESC LIMIT 1`) : none(),
    !pots ? none() : rows(sql`
      WITH f AS (
        SELECT player_id, placed_at, won, payout_usd - wagered_usd AS profit,
               row_number() OVER (PARTITION BY player_id ORDER BY placed_at)
             - row_number() OVER (PARTITION BY player_id, won ORDER BY placed_at) AS grp
        FROM bets WHERE site = ${site} AND game = 'coinflip' AND NOT is_house AND settled_at IS NOT NULL AND placed_at >= ${from} AND placed_at < ${to}),
      s AS (
        SELECT player_id, count(*) AS streak, sum(profit) AS profit, min(placed_at) AS started, max(placed_at) AS ended
        FROM f WHERE won GROUP BY player_id, grp ORDER BY streak DESC, profit DESC LIMIT 1)
      SELECT s.*, p.display_name, p.avatar FROM s LEFT JOIN players p ON p.site = ${site} AND p.external_id = s.player_id`),
    pots ? rows(sql`${flipSelect} ${flipsIn} AND c.house_involved AND NOT c.winner_house ORDER BY c.pot_usd DESC NULLS LAST LIMIT 1`) : none(),
    rows(sql`SELECT bucket, sum(wagered_usd) wagered, sum(bets) bets FROM bets_hourly WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to} GROUP BY bucket ORDER BY wagered DESC NULLS LAST LIMIT 1`),
  ]);
  return { flip, playerWin, playerLoss, houseFlip, houseJackpot, jackpot, longShot, streak, botLoss, peak };
}

/**
 * Longer ranges: the daily aggregates say which day holds each extreme and
 * what the value is (a few dozen rows), then one indexed lookup fetches the
 * round itself from that day. Streaks come from the hourly job's table.
 */
async function recordRowsDaily(site: string, range: Range, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>): Promise<RecordRows> {
  const pots = hasPots(site);
  const [flipDays, potDays, betDays, [streakRow], [peak]] = await Promise.all([
    pots ? rows(sql`SELECT bucket, max_pot, max_house_gross, max_bot_loss FROM flips_daily WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`) : none(),
    pots ? rows(sql`SELECT bucket, max_pot, max_house_gross, min_chance FROM jackpots_daily WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`) : none(),
    rows(sql`SELECT bucket, game, max_payout, max_loss FROM bets_daily_records WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`),
    !pots ? none() : rows(sql`
      SELECT s.player_id, s.streak, s.profit_usd AS profit, s.started_at AS started, s.ended_at AS ended, p.display_name, p.avatar
      FROM streaks s LEFT JOIN players p ON p.site = s.site AND p.external_id = s.player_id
      WHERE s.site = ${site} AND s.days = ${range} AND s.streak > 0`),
    rows(sql`SELECT bucket, sum(wagered_usd) wagered, sum(bets) bets FROM bets_hourly WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to} GROUP BY bucket ORDER BY wagered DESC NULLS LAST LIMIT 1`),
  ]);
  const best = (xs: Row[], col: string, dir: "max" | "min" = "max") =>
    xs.reduce<Row | null>((acc, x) => (x[col] == null ? acc : !acc || (dir === "max" ? n(x[col]) > n(acc[col]) : n(x[col]) < n(acc[col])) ? x : acc), null);
  const day = (d: Row) => sql`AND c.created_at >= ${dayStart(d.bucket)}::timestamptz AND c.created_at < ${dayAfter(d.bucket)}::timestamptz`;
  const jday = (d: Row) => sql`AND j.created_at >= ${dayStart(d.bucket)}::timestamptz AND j.created_at < ${dayAfter(d.bucket)}::timestamptz`;
  const flipIn = sql`WHERE c.site = ${site} AND c.status = 'Ended'`;
  const potIn = sql`WHERE j.site = ${site} AND j.status = 'Ended'`;

  const dPot = best(flipDays, "max_pot");
  const dGross = best(flipDays, "max_house_gross");
  const dLoss = best(flipDays, "max_bot_loss");
  const dJack = best(potDays, "max_pot");
  const dJackGross = best(potDays, "max_house_gross");
  const dShot = best(potDays, "min_chance", "min");
  const dPay = best(betDays, "max_payout");
  const dLoss2 = best(betDays, "max_loss");
  const betDay = (d: Row) => sql`AND b.placed_at >= ${dayStart(d.bucket)}::timestamptz AND b.placed_at < ${dayAfter(d.bucket)}::timestamptz`;

  const [[flip], [houseFlip], [botLoss], [jackpot], [houseJackpot], [longShot], [playerWin], [playerLoss]] = await Promise.all([
    dPot ? rows(sql`${flipSelect} ${flipIn} ${day(dPot)} AND c.pot_usd = ${String(dPot.max_pot)}::numeric ORDER BY c.created_at LIMIT 1`) : [],
    dGross ? rows(sql`${flipSelect} ${flipIn} ${day(dGross)} AND ${houseGross} = ${String(dGross.max_house_gross)}::numeric ORDER BY c.created_at LIMIT 1`) : [],
    dLoss ? rows(sql`${flipSelect} ${flipIn} ${day(dLoss)} AND c.house_involved AND NOT c.winner_house AND c.pot_usd = ${String(dLoss.max_bot_loss)}::numeric ORDER BY c.created_at LIMIT 1`) : [],
    dJack ? rows(sql`${jackpotSelect} ${potIn} ${jday(dJack)} AND j.pot_usd = ${String(dJack.max_pot)}::numeric ORDER BY j.created_at LIMIT 1`) : [],
    dJackGross ? rows(sql`${jackpotSelect} ${potIn} ${jday(dJackGross)} AND ${jackpotGross} = ${String(dJackGross.max_house_gross)}::numeric ORDER BY j.created_at LIMIT 1`) : [],
    dShot ? rows(sql`${jackpotSelect} ${potIn} ${jday(dShot)} AND j.pot_usd >= 25 AND (j.meta->>'winnerChance')::numeric = ${String(dShot.min_chance)}::numeric ORDER BY j.pot_usd DESC LIMIT 1`) : [],
    dPay
      ? rows(sql`${betSelect} WHERE b.site = ${site} AND b.game = ${String(dPay.game)} AND NOT b.is_house AND b.settled_at IS NOT NULL ${betDay(dPay)}
            AND b.payout_usd = ${String(dPay.max_payout)}::numeric ORDER BY b.placed_at LIMIT 1`)
      : [],
    dLoss2
      ? rows(sql`${betSelect} WHERE b.site = ${site} AND b.game = ${String(dLoss2.game)} AND NOT b.is_house AND b.settled_at IS NOT NULL ${betDay(dLoss2)}
            AND NOT coalesce(b.won, false) AND b.wagered_usd = ${String(dLoss2.max_loss)}::numeric ORDER BY b.placed_at LIMIT 1`)
      : [],
  ]);
  return { flip, playerWin, playerLoss, houseFlip, houseJackpot, jackpot, longShot, streak: streakRow, botLoss, peak };
}

/** Biggest pot, biggest payouts, biggest house take, longest shot, longest streak and busiest hour in range. */
export const highlights = (site: string, range: Range) => memo(`records:${site}:${range}`, ttlFor(range), () => highlightsQuery(site, range));
async function highlightsQuery(site: string, range: Range): Promise<Highlights> {
  const { from, to } = window(range);
  const r = range === 1 ? await recordRowsDirect(site, from, to) : await recordRowsDaily(site, range, from, to);
  const { flip, playerWin, playerLoss, houseFlip, houseJackpot, jackpot, longShot, streak, botLoss, peak } = r;

  const biggestFlip = flip ? flipHighlight(flip, n(flip.pot_usd)) : null;

  // Records are pre-tax. A bet's payout is stored net of the site's cut, so a pot game win reads the round's pot instead.
  const winGame = playerWin ? String(playerWin.game) : "";
  const [winRound] =
    playerWin && hasPots(site) && playerWin.round_id != null && (winGame === "coinflip" || winGame === "jackpot")
      ? await rows(
          winGame === "coinflip"
            ? sql`SELECT pot_usd FROM coinflips WHERE site = ${site} AND external_id = ${String(playerWin.round_id)}`
            : sql`SELECT pot_usd FROM jackpots WHERE site = ${site} AND external_id = ${String(playerWin.round_id)}`,
        )
      : [];

  // Gross figures: the pre-tax win, with the stake in the caption.
  const biggestPlayerWin: Highlight | null = playerWin
    ? {
        amount: winRound?.pot_usd != null ? n(winRound.pot_usd) : n(playerWin.payout_usd),
        at: iso(playerWin.settled_at ?? playerWin.placed_at),
        game: String(playerWin.game),
        roundId: str(playerWin.round_id) ?? "",
        caption: `${str(playerWin.display_name) ?? String(playerWin.player_id)} on ${gameLabel(String(playerWin.game)).toLowerCase()}${staked(playerWin.wagered_usd)}`,
        players: [who(playerWin.display_name, playerWin.player_id, playerWin.avatar, false)],
      }
    : null;

  const houseFlipGross = houseFlip ? (houseFlip.winner_house ? n(houseFlip.pot_usd) : n(houseFlip.tax_usd)) : -Infinity;
  const houseJackpotGross = houseJackpot ? (houseJackpot.winner_house ? n(houseJackpot.pot_usd) : n(houseJackpot.tax_usd)) : -Infinity;
  let biggestSiteWin: Highlight | null = null;
  if (!hasPots(site)) {
    // No house bot or rake to point at: the site's biggest single win is the biggest stake a player lost.
    biggestSiteWin = playerLoss
      ? {
          amount: n(playerLoss.wagered_usd),
          at: iso(playerLoss.settled_at ?? playerLoss.placed_at),
          game: String(playerLoss.game),
          roundId: str(playerLoss.round_id) ?? "",
          caption: `${str(playerLoss.display_name) ?? String(playerLoss.player_id)} lost on ${gameLabel(String(playerLoss.game)).toLowerCase()}`,
          players: [who(playerLoss.display_name, playerLoss.player_id, playerLoss.avatar, false)],
        }
      : null;
  } else if (houseFlip && houseFlipGross >= houseJackpotGross) {
    if (houseFlip.winner_house) {
      biggestSiteWin = flipHighlight(houseFlip, houseFlipGross, staked(houseFlip.creator_house ? houseFlip.creator_total : houseFlip.opponent_total));
    } else {
      const h = flipHighlight(houseFlip, houseFlipGross);
      biggestSiteWin = { ...h, caption: `Tax on ${h.caption}` };
    }
  } else if (houseJackpot) {
    const w = jackpotWinner(houseJackpot);
    biggestSiteWin = jackpotHighlight(
      houseJackpot,
      houseJackpotGross,
      houseJackpot.winner_house ? `${w.name} won the ${moneyForCaption(n(houseJackpot.pot_usd))} pot` : `Tax on a ${moneyForCaption(n(houseJackpot.pot_usd))} jackpot won by ${w.name}`,
    );
  }

  const biggestJackpot = jackpot ? jackpotHighlight(jackpot, n(jackpot.pot_usd), `${jackpotWinner(jackpot).name} won${chance(jackpot.winner_chance)}`) : null;
  const longestShot = longShot ? jackpotHighlight(longShot, n(longShot.pot_usd), `${jackpotWinner(longShot).name} won${chance(longShot.winner_chance)}`) : null;
  const longestStreak: Highlight | null = streak
    ? {
        amount: n(streak.streak),
        format: "count",
        at: iso(streak.ended),
        game: "coinflip",
        roundId: "",
        caption: `${str(streak.display_name) ?? String(streak.player_id)} · ${n(streak.profit) >= 0 ? "+" : "−"}${moneyForCaption(Math.abs(n(streak.profit)))} over the run`,
        players: [who(streak.display_name, streak.player_id, streak.avatar, false)],
      }
    : null;
  const biggestBotLoss: Highlight | null = botLoss
    ? flipHighlight(botLoss, n(botLoss.pot_usd), staked(botLoss.creator_house ? botLoss.creator_total : botLoss.opponent_total).replace("staked", "bot staked"))
    : null;
  const peakHour: Highlight | null = peak
    ? { amount: n(peak.wagered), at: iso(peak.bucket), game: "hourly", roundId: "", caption: `${new Intl.NumberFormat("en-US").format(n(peak.bets))} bets in the hour from ${new Date(peak.bucket as string).toLocaleTimeString("en-US", { hour: "numeric", hour12: true, timeZone: "UTC" })} UTC`, players: [] }
    : null;
  return { biggestFlip, biggestPlayerWin, biggestSiteWin, biggestJackpot, longestShot, longestStreak, biggestBotLoss, peakHour };
}

// ---------------------------------------------------------------- player profiles

/** Links at or above this score count toward a profile's totals; weaker ones are shown but kept separate. */
export const COUNTED_AT = 0.7;

const accountOf = (x: Row): Account => ({
  site: String(x.site),
  id: String(x.external_id),
  handle: str(x.display_name) ?? String(x.external_id),
  avatar: str(x.avatar),
  admin: Boolean(x.is_admin),
  firstSeen: x.first_seen ? iso(x.first_seen) : null,
  lastSeen: x.last_seen ? iso(x.last_seen) : null,
});

export async function account(site: string, id: string): Promise<Account | null> {
  const r = await rows(sql`SELECT site, external_id, display_name, avatar, is_admin, first_seen, last_seen FROM players WHERE site = ${site} AND external_id = ${id} AND NOT is_house`);
  return r[0] ? accountOf(r[0]) : null;
}

/**
 * Accounts linked to this one, directly or through one other account. A
 * chain's confidence is its weakest link; an account reachable more than
 * one way keeps the best.
 */
export async function linkedAccounts(site: string, id: string): Promise<LinkedAccount[]> {
  const r = await rows(sql`
    WITH RECURSIVE walk AS (
      SELECT other_site AS site, other_player AS player, score, evidence, 1 AS hops
      FROM player_links_both WHERE site = ${site} AND player = ${id}
      UNION ALL
      SELECT l.other_site, l.other_player, LEAST(w.score, l.score), l.evidence, w.hops + 1
      FROM walk w JOIN player_links_both l ON l.site = w.site AND l.player = w.player
      WHERE w.hops < 2 AND NOT (l.other_site = ${site} AND l.other_player = ${id})
    ),
    best AS (
      SELECT site, player, max(score) AS score, (array_agg(evidence ORDER BY score DESC, hops))[1] AS evidence, min(hops) AS hops
      FROM walk GROUP BY site, player
    )
    SELECT b.site, b.player AS external_id, b.score, b.evidence, b.hops, p.display_name, p.avatar, p.is_admin, p.first_seen, p.last_seen
    FROM best b JOIN players p ON p.site = b.site AND p.external_id = b.player
    ORDER BY b.score DESC, p.last_seen DESC`);
  return r.map((x) => ({ ...accountOf(x), score: n(x.score), evidence: x.evidence as LinkEvidence, hops: n(x.hops) }));
}

const accountFilter = (accounts: Account[], alias: string) =>
  accounts.length
    ? sql`(${sql.join(accounts.map((a) => sql`(${sql.raw(alias)}.site = ${a.site} AND ${sql.raw(alias)}.player_id = ${a.id})`), sql` OR `)})`
    : sql`false`;

const emptyTotals = (): PlayerTotals => ({ wagered: 0, payout: 0, net: 0, bets: 0, wins: 0, activeDays: 0, favorite: "" });

/** Per-account stats over the range, from the bets themselves (24h) or the daily rollup. */
async function accountTotals(accounts: Account[], range: Range): Promise<Map<string, PlayerTotals>> {
  const { from, to } = window(range);
  const out = new Map<string, PlayerTotals>();
  if (!accounts.length) return out;
  const r =
    range === 1
      ? await rows(sql`
          SELECT b.site, b.player_id, sum(wagered_usd) wagered, sum(payout_usd) payout, count(*) bets, count(*) FILTER (WHERE won) wins,
                 count(DISTINCT date_trunc('day', placed_at)) active_days, mode() WITHIN GROUP (ORDER BY game) favorite
          FROM bets b WHERE settled_at IS NOT NULL AND NOT is_house AND placed_at >= ${from} AND placed_at < ${to} AND ${accountFilter(accounts, "b")}
          GROUP BY b.site, b.player_id`)
      : await rows(sql`
          WITH d AS (
            SELECT b.site, b.player_id, b.game, sum(wagered_usd) wagered, sum(payout_usd) payout, sum(bets) bets, count(DISTINCT bucket) days
            FROM player_daily b WHERE bucket >= ${from} AND bucket < ${to} AND ${accountFilter(accounts, "b")}
            GROUP BY b.site, b.player_id, b.game),
          w AS (
            SELECT b.site, b.player_id, count(*) FILTER (WHERE won) wins
            FROM bets b WHERE settled_at IS NOT NULL AND NOT is_house AND placed_at >= ${from} AND placed_at < ${to} AND ${accountFilter(accounts, "b")}
            GROUP BY b.site, b.player_id)
          SELECT d.site, d.player_id, sum(wagered) wagered, sum(payout) payout, sum(bets) bets, max(w.wins) wins,
                 (SELECT count(DISTINCT bucket) FROM player_daily x WHERE x.site = d.site AND x.player_id = d.player_id AND bucket >= ${from} AND bucket < ${to}) active_days,
                 (array_agg(game ORDER BY wagered DESC))[1] favorite
          FROM d LEFT JOIN w ON w.site = d.site AND w.player_id = d.player_id
          GROUP BY d.site, d.player_id`);
  for (const x of r) {
    out.set(`${x.site}:${x.player_id}`, {
      wagered: n(x.wagered), payout: n(x.payout), net: n(x.payout) - n(x.wagered), bets: n(x.bets), wins: n(x.wins),
      activeDays: n(x.active_days), favorite: gameLabel(String(x.favorite ?? "")),
    });
  }
  return out;
}

/** Wager and player net per bucket for a set of accounts, summed. */
async function accountSeries(accounts: Account[], range: Range): Promise<PlayerPoint[]> {
  if (!accounts.length) return [];
  const { from, to } = window(range);
  const r =
    range === 1
      ? await rows(sql`
          SELECT date_trunc('hour', placed_at) t, sum(wagered_usd) wagered, sum(payout_usd - wagered_usd) net, count(*) bets
          FROM bets b WHERE settled_at IS NOT NULL AND NOT is_house AND placed_at >= ${from} AND placed_at < ${to} AND ${accountFilter(accounts, "b")}
          GROUP BY 1 ORDER BY 1`)
      : await rows(sql`
          SELECT bucket t, sum(wagered_usd) wagered, sum(payout_usd - wagered_usd) net, sum(bets) bets
          FROM player_daily b WHERE bucket >= ${from} AND bucket < ${to} AND ${accountFilter(accounts, "b")}
          GROUP BY 1 ORDER BY 1`);
  return r.map((x) => ({ t: iso(x.t), wagered: n(x.wagered), net: n(x.net), bets: n(x.bets) }));
}

/** Games a set of accounts played in the range. `net` is the house's, as on the site pages. */
async function accountGames(accounts: Account[], range: Range): Promise<GameStat[]> {
  if (!accounts.length) return [];
  const { from, to } = window(range);
  const r =
    range === 1
      ? await rows(sql`
          SELECT game, sum(wagered_usd) wagered, count(*) plays, sum(wagered_usd - payout_usd) net
          FROM bets b WHERE settled_at IS NOT NULL AND NOT is_house AND placed_at >= ${from} AND placed_at < ${to} AND ${accountFilter(accounts, "b")}
          GROUP BY game ORDER BY wagered DESC`)
      : await rows(sql`
          SELECT game, sum(wagered_usd) wagered, sum(bets) plays, sum(wagered_usd - payout_usd) net
          FROM player_daily b WHERE bucket >= ${from} AND bucket < ${to} AND ${accountFilter(accounts, "b")}
          GROUP BY game ORDER BY wagered DESC`);
  return r.map((x) => ({ name: gameLabel(String(x.game)), wagered: n(x.wagered), plays: n(x.plays), net: n(x.net) }));
}

/**
 * Newest settled bets by a set of accounts. Rows carry the site so a mixed
 * list can link each round to its site. An admin-marked account's bets are
 * listed (the profile is admin-only) even though its totals above are empty.
 */
async function accountBets(accounts: Account[], range: Range, limit = 25): Promise<(BetRow & { site: string })[]> {
  if (!accounts.length) return [];
  const hours = range === 1 ? 24 : range * 24;
  const r = await rows(sql`
    SELECT b.site, b.game, b.external_id, b.round_id, b.player_id, b.placed_at, b.settled_at, b.wagered_usd, b.payout_usd, b.won, p.display_name, p.avatar, p.is_admin
    FROM bets b LEFT JOIN players p ON p.site = b.site AND p.external_id = b.player_id
    WHERE (NOT b.is_house OR p.is_admin) AND b.settled_at IS NOT NULL AND ${accountFilter(accounts, "b")}
      AND b.placed_at >= now() - make_interval(hours => ${hours}) - interval '1 day' AND b.settled_at >= now() - make_interval(hours => ${hours})
    ORDER BY b.settled_at DESC LIMIT ${limit}`);
  return r.map((x) => ({
    site: String(x.site),
    id: `${x.site}:${x.game}:${x.external_id}`,
    game: String(x.game),
    roundId: str(x.round_id),
    placedAt: iso(x.placed_at),
    settledAt: iso(x.settled_at),
    player: { id: String(x.player_id), name: str(x.display_name) ?? String(x.player_id), avatar: str(x.avatar), admin: Boolean(x.is_admin) },
    wagered: n(x.wagered_usd),
    payout: n(x.payout_usd),
    won: x.won == null ? null : Boolean(x.won),
  }));
}

const sumTotals = (parts: PlayerTotals[]): PlayerTotals => {
  const t = emptyTotals();
  let best: { g: string; w: number } | null = null;
  for (const p of parts) {
    t.wagered += p.wagered; t.payout += p.payout; t.net += p.net; t.bets += p.bets; t.wins += p.wins; t.activeDays = Math.max(t.activeDays, p.activeDays);
    if (p.favorite && (!best || p.wagered > best.w)) best = { g: p.favorite, w: p.wagered };
  }
  t.favorite = best?.g ?? "";
  return t;
};

/** Everything the profile page shows for one account and the accounts linked to it. */
export async function playerProfile(site: string, id: string, range: Range): Promise<PlayerProfile | null> {
  const anchor = await account(site, id);
  if (!anchor) return null;
  const linked = await linkedAccounts(site, id);
  const countedAccounts: Account[] = [anchor, ...linked.filter((l) => l.score >= COUNTED_AT)];
  const keyed = countedAccounts.map((a) => a.id).filter((x) => /^7656119[0-9]{10}$/.test(x));
  const learned = keyed.length
    ? []
    : await rows(sql`SELECT steam_id FROM player_identities pi WHERE (${sql.join(countedAccounts.map((a) => sql`(pi.site = ${a.site} AND pi.external_id = ${a.id})`), sql` OR `)}) ORDER BY last_seen DESC LIMIT 1`);
  const steamIds = [...new Set([...keyed, ...learned.map((x) => String(x.steam_id))])];
  const steam = steamIds.length ? await steamProfile(steamIds[0]) : null;
  const [totalsBy, series, games, recent, ...perAccount] = await Promise.all([
    accountTotals(countedAccounts, range),
    accountSeries(countedAccounts, range),
    accountGames(countedAccounts, range),
    accountBets(countedAccounts, range, 30),
    ...countedAccounts.map((a) => Promise.all([accountSeries([a], range), accountGames([a], range), accountBets([a], range, 20)])),
  ]);
  const counted: AccountStats[] = countedAccounts.map((a, i) => ({
    account: a,
    totals: totalsBy.get(`${a.site}:${a.id}`) ?? emptyTotals(),
    series: perAccount[i][0],
    games: perAccount[i][1],
    recent: perAccount[i][2],
  }));
  return { range, anchor, linked, countedAt: COUNTED_AT, counted, totals: sumTotals(counted.map((c) => c.totals)), combined: { series, games, recent }, steamId: steamIds[0] ?? null, steam };
}

/** Steam profile data for a Steam-keyed account, when the collector has fetched it. */
export async function steamProfile(steamId: string): Promise<SteamProfile | null> {
  if (!/^7656119[0-9]{10}$/.test(steamId)) return null;
  const [p, a] = await Promise.all([
    rows(sql`SELECT * FROM steam_profiles WHERE steam_id = ${steamId}`),
    rows(sql`SELECT name, seen_at FROM steam_aliases WHERE steam_id = ${steamId} ORDER BY seen_at DESC NULLS LAST, name LIMIT 20`),
  ]);
  const x = p[0];
  if (!x || !x.fetched_at) return null;
  return {
    steamId, persona: str(x.persona), avatar: str(x.avatar), profileUrl: str(x.profile_url) ?? `https://steamcommunity.com/profiles/${steamId}`, visibility: str(x.visibility) ?? "unknown",
    country: str(x.country), accountCreatedAt: x.account_created_at ? iso(x.account_created_at) : null, lastLogoffAt: x.last_logoff_at ? iso(x.last_logoff_at) : null,
    vacBanned: x.vac_banned == null ? null : Boolean(x.vac_banned), gameBans: x.game_bans == null ? null : Number(x.game_bans), friendsCount: x.friends_count == null ? null : Number(x.friends_count),
    aliases: a.map((r) => ({ name: String(r.name), seenAt: r.seen_at ? iso(r.seen_at) : null })), fetchedAt: iso(x.fetched_at),
  };
}
