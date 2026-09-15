import "server-only";
import { sql } from "@casino/db";
import { db } from "./db";
import { CASINOS, gameLabel } from "./casinos";
import { memo, ttlFor } from "./memo";
import type { CoinflipRound, GameStat, Highlight, Highlights, JackpotRound, PlayerStat, Point, ProfitBreakdown, Range, SiteCard, SiteStatus, Summary } from "./types";

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const rows = async (q: ReturnType<typeof sql>) => (await db().execute(q)) as unknown as Row[];

export function parseRange(v: string | string[] | undefined): Range {
  const r = Number(Array.isArray(v) ? v[0] : v);
  return r === 1 || r === 7 || r === 30 || r === 90 ? r : 30;
}

/** Sites that have a collector row, i.e. real data. */
export async function trackedSites(): Promise<string[]> {
  const r = await rows(sql`SELECT DISTINCT site FROM bets_daily UNION SELECT site FROM collector_status`);
  return r.map((x) => String(x.site));
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
                 count(DISTINCT player_id) players, count(*) bets
          FROM bets WHERE settled_at IS NOT NULL AND NOT is_house
            AND placed_at >= ${from} AND placed_at < ${to} ${siteFilter}`)
      : await rows(sql`
          SELECT coalesce((SELECT sum(wagered_usd) FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) wagered,
                 coalesce((SELECT sum(payout_usd)  FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) payout,
                 coalesce((SELECT sum(bets)        FROM bets_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}), 0) bets,
                 (SELECT count(DISTINCT player_id) FROM player_daily WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}) players`);
  return { wagered: n(r?.wagered), payout: n(r?.payout), players: n(r?.players), bets: n(r?.bets) };
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
const round2 = (v: number) => Math.round(v * 100) / 100;
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
  houseFlip: Row | undefined;
  houseJackpot: Row | undefined;
  jackpot: Row | undefined;
  longShot: Row | undefined;
  streak: Row | undefined;
  botLoss: Row | undefined;
  peak: Row | undefined;
};

/** 24h: one day of rounds, scanned directly. */
async function recordRowsDirect(site: string, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>): Promise<RecordRows> {
  const flipsIn = sql`WHERE c.site = ${site} AND c.status = 'Ended' AND c.created_at >= ${from} AND c.created_at < ${to}`;
  const potsIn = sql`WHERE j.site = ${site} AND j.status = 'Ended' AND j.created_at >= ${from} AND j.created_at < ${to}`;
  const [[flip], [playerWin], [houseFlip], [houseJackpot], [jackpot], [longShot], [streak], [botLoss], [peak]] = await Promise.all([
    rows(sql`${flipSelect} ${flipsIn} ORDER BY c.pot_usd DESC NULLS LAST LIMIT 1`),
    rows(sql`
      SELECT b.game, b.round_id, b.player_id, b.settled_at, b.placed_at, b.payout_usd, b.wagered_usd, p.display_name, p.avatar
      FROM bets b LEFT JOIN players p ON p.site = b.site AND p.external_id = b.player_id
      WHERE b.site = ${site} AND NOT b.is_house AND b.settled_at IS NOT NULL AND b.placed_at >= ${from} AND b.placed_at < ${to}
      ORDER BY b.payout_usd DESC LIMIT 1`),
    rows(sql`${flipSelect} ${flipsIn} ORDER BY ${houseGross} DESC NULLS LAST LIMIT 1`),
    rows(sql`${jackpotSelect} ${potsIn} ORDER BY ${jackpotGross} DESC NULLS LAST LIMIT 1`),
    rows(sql`${jackpotSelect} ${potsIn} ORDER BY j.pot_usd DESC NULLS LAST LIMIT 1`),
    rows(sql`${jackpotSelect} ${potsIn} AND (j.meta->>'winnerChance')::numeric > 0 AND j.pot_usd >= 25 ORDER BY (j.meta->>'winnerChance')::numeric ASC, j.pot_usd DESC LIMIT 1`),
    rows(sql`
      WITH f AS (
        SELECT player_id, placed_at, won, payout_usd - wagered_usd AS profit,
               row_number() OVER (PARTITION BY player_id ORDER BY placed_at)
             - row_number() OVER (PARTITION BY player_id, won ORDER BY placed_at) AS grp
        FROM bets WHERE site = ${site} AND game = 'coinflip' AND NOT is_house AND settled_at IS NOT NULL AND placed_at >= ${from} AND placed_at < ${to}),
      s AS (
        SELECT player_id, count(*) AS streak, sum(profit) AS profit, min(placed_at) AS started, max(placed_at) AS ended
        FROM f WHERE won GROUP BY player_id, grp ORDER BY streak DESC, profit DESC LIMIT 1)
      SELECT s.*, p.display_name, p.avatar FROM s LEFT JOIN players p ON p.site = ${site} AND p.external_id = s.player_id`),
    rows(sql`${flipSelect} ${flipsIn} AND c.house_involved AND NOT c.winner_house ORDER BY c.pot_usd DESC NULLS LAST LIMIT 1`),
    rows(sql`SELECT bucket, sum(wagered_usd) wagered, sum(bets) bets FROM bets_hourly WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to} GROUP BY bucket ORDER BY wagered DESC NULLS LAST LIMIT 1`),
  ]);
  return { flip, playerWin, houseFlip, houseJackpot, jackpot, longShot, streak, botLoss, peak };
}

/**
 * Longer ranges: the daily aggregates say which day holds each extreme and
 * what the value is (a few dozen rows), then one indexed lookup fetches the
 * round itself from that day. Streaks come from the hourly job's table.
 */
async function recordRowsDaily(site: string, range: Range, from: ReturnType<typeof sql>, to: ReturnType<typeof sql>): Promise<RecordRows> {
  const [flipDays, potDays, betDays, [streakRow], [peak]] = await Promise.all([
    rows(sql`SELECT bucket, max_pot, max_house_gross, max_bot_loss FROM flips_daily WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`),
    rows(sql`SELECT bucket, max_pot, max_house_gross, min_chance FROM jackpots_daily WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`),
    rows(sql`SELECT bucket, game, max_payout FROM bets_daily_records WHERE site = ${site} AND bucket >= ${from} AND bucket < ${to}`),
    rows(sql`
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

  const [[flip], [houseFlip], [botLoss], [jackpot], [houseJackpot], [longShot], [playerWin]] = await Promise.all([
    dPot ? rows(sql`${flipSelect} ${flipIn} ${day(dPot)} AND c.pot_usd = ${String(dPot.max_pot)}::numeric ORDER BY c.created_at LIMIT 1`) : [],
    dGross ? rows(sql`${flipSelect} ${flipIn} ${day(dGross)} AND ${houseGross} = ${String(dGross.max_house_gross)}::numeric ORDER BY c.created_at LIMIT 1`) : [],
    dLoss ? rows(sql`${flipSelect} ${flipIn} ${day(dLoss)} AND c.house_involved AND NOT c.winner_house AND c.pot_usd = ${String(dLoss.max_bot_loss)}::numeric ORDER BY c.created_at LIMIT 1`) : [],
    dJack ? rows(sql`${jackpotSelect} ${potIn} ${jday(dJack)} AND j.pot_usd = ${String(dJack.max_pot)}::numeric ORDER BY j.created_at LIMIT 1`) : [],
    dJackGross ? rows(sql`${jackpotSelect} ${potIn} ${jday(dJackGross)} AND ${jackpotGross} = ${String(dJackGross.max_house_gross)}::numeric ORDER BY j.created_at LIMIT 1`) : [],
    dShot ? rows(sql`${jackpotSelect} ${potIn} ${jday(dShot)} AND j.pot_usd >= 25 AND (j.meta->>'winnerChance')::numeric = ${String(dShot.min_chance)}::numeric ORDER BY j.pot_usd DESC LIMIT 1`) : [],
    dPay
      ? rows(sql`
          SELECT b.game, b.round_id, b.player_id, b.settled_at, b.placed_at, b.payout_usd, b.wagered_usd, p.display_name, p.avatar
          FROM bets b LEFT JOIN players p ON p.site = b.site AND p.external_id = b.player_id
          WHERE b.site = ${site} AND b.game = ${String(dPay.game)} AND NOT b.is_house AND b.settled_at IS NOT NULL
            AND b.placed_at >= ${dayStart(dPay.bucket)}::timestamptz AND b.placed_at < ${dayAfter(dPay.bucket)}::timestamptz
            AND b.payout_usd = ${String(dPay.max_payout)}::numeric
          ORDER BY b.placed_at LIMIT 1`)
      : [],
  ]);
  return { flip, playerWin, houseFlip, houseJackpot, jackpot, longShot, streak: streakRow, botLoss, peak };
}

/** Biggest pot, biggest payouts, biggest house take, longest shot, longest streak and busiest hour in range. */
export const highlights = (site: string, range: Range) => memo(`records:${site}:${range}`, ttlFor(range), () => highlightsQuery(site, range));
async function highlightsQuery(site: string, range: Range): Promise<Highlights> {
  const { from, to } = window(range);
  const r = range === 1 ? await recordRowsDirect(site, from, to) : await recordRowsDaily(site, range, from, to);
  const { flip, playerWin, houseFlip, houseJackpot, jackpot, longShot, streak, botLoss, peak } = r;

  const biggestFlip = flip ? flipHighlight(flip, n(flip.pot_usd)) : null;

  // Gross figures: what the winner received, with the stake in the caption.
  const biggestPlayerWin: Highlight | null = playerWin
    ? {
        amount: n(playerWin.payout_usd),
        at: iso(playerWin.settled_at ?? playerWin.placed_at),
        game: String(playerWin.game) === "jackpot" ? "jackpot" : "coinflip",
        roundId: str(playerWin.round_id) ?? "",
        caption: `${str(playerWin.display_name) ?? String(playerWin.player_id)} on ${gameLabel(String(playerWin.game)).toLowerCase()}${staked(playerWin.wagered_usd)}`,
        players: [who(playerWin.display_name, playerWin.player_id, playerWin.avatar, false)],
      }
    : null;

  const houseFlipGross = houseFlip ? (houseFlip.winner_house ? n(houseFlip.pot_usd) : n(houseFlip.tax_usd)) : -Infinity;
  const houseJackpotGross = houseJackpot ? (houseJackpot.winner_house ? n(houseJackpot.pot_usd) : n(houseJackpot.tax_usd)) : -Infinity;
  let biggestSiteWin: Highlight | null = null;
  if (houseFlip && houseFlipGross >= houseJackpotGross) {
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
    ? flipHighlight(botLoss, round2(n(botLoss.pot_usd) - n(botLoss.tax_usd)), staked(botLoss.creator_house ? botLoss.creator_total : botLoss.opponent_total).replace("staked", "bot staked"))
    : null;
  const peakHour: Highlight | null = peak
    ? { amount: n(peak.wagered), at: iso(peak.bucket), game: "hourly", roundId: "", caption: `${new Intl.NumberFormat("en-US").format(n(peak.bets))} bets in the hour from ${new Date(peak.bucket as string).toLocaleTimeString("en-US", { hour: "numeric", hour12: true, timeZone: "UTC" })} UTC`, players: [] }
    : null;
  return { biggestFlip, biggestPlayerWin, biggestSiteWin, biggestJackpot, longestShot, longestStreak, biggestBotLoss, peakHour };
}
