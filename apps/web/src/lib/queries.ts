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
 * Splits house net into the bot's own coinflip results and the rake on each
 * game. For a flip the house played, house_net_usd already nets tax and the
 * bot's stake, so bot = house_net − tax; flips between two real players
 * contribute tax only. Jackpot rake comes from the jackpots table so legacy
 * rounds (which have no bets rows) still count.
 */
export const profitBreakdown = (site: string, range: Range) => memo(`breakdown:${site}:${range}`, ttlFor(range), () => profitBreakdownQuery(site, range));
async function profitBreakdownQuery(site: string, range: Range): Promise<ProfitBreakdown> {
  const hours = range === 1 ? 24 : range * 24;
  const since = sql`now() - make_interval(hours => ${hours})`;
  const [[c], [j]] = await Promise.all([
    rows(sql`
      SELECT coalesce(sum(tax_usd), 0) flip_tax,
             coalesce(sum(house_net_usd - coalesce(tax_usd, 0)) FILTER (WHERE house_involved), 0) bot_net,
             count(*) FILTER (WHERE house_involved) house_flips,
             coalesce(bool_or((meta->>'taxEstimated')::boolean), false) estimated
      FROM coinflips WHERE site = ${site} AND status = 'Ended' AND created_at >= ${since}`),
    rows(sql`
      SELECT coalesce(sum(tax_usd), 0) jackpot_tax, coalesce(bool_or((meta->>'taxEstimated')::boolean), false) estimated
      FROM jackpots WHERE site = ${site} AND status = 'Ended' AND created_at >= ${since}`),
  ]);
  const botNet = n(c?.bot_net);
  const flipTax = n(c?.flip_tax);
  const jackpotTax = n(j?.jackpot_tax);
  return { botNet, flipTax, jackpotTax, total: botNet + flipTax + jackpotTax, houseFlips: n(c?.house_flips), estimated: Boolean(c?.estimated) || Boolean(j?.estimated) };
}

const who = (name: unknown, id: unknown, avatar: unknown, house: unknown) => ({ name: str(name) ?? String(id ?? "?"), avatar: str(avatar), house: Boolean(house) });

const flipSelect = sql`
  SELECT c.external_id, c.settled_at, c.created_at, c.pot_usd, c.house_net_usd, c.winner_id, c.creator_id, c.opponent_id,
         pc.display_name creator_name, pc.avatar creator_avatar, coalesce(pc.is_house, false) creator_house,
         po.display_name opponent_name, po.avatar opponent_avatar, coalesce(po.is_house, false) opponent_house
  FROM coinflips c
  LEFT JOIN players pc ON pc.site = c.site AND pc.external_id = c.creator_id
  LEFT JOIN players po ON po.site = c.site AND po.external_id = c.opponent_id`;

function flipHighlight(x: Row, amount: number): Highlight {
  const creator = who(x.creator_name, x.creator_id, x.creator_avatar, x.creator_house);
  const opponent = who(x.opponent_name, x.opponent_id, x.opponent_avatar, x.opponent_house);
  const creatorWon = str(x.winner_id) === str(x.creator_id);
  const [winner, loser] = creatorWon ? [creator, opponent] : [opponent, creator];
  return { amount, at: iso(x.settled_at ?? x.created_at), game: "coinflip", roundId: String(x.external_id), caption: `${winner.name} beat ${loser.name}`, players: [creator, opponent] };
}

/** Biggest pot, biggest single-bet player profit, and biggest single-round house take in range. */
export const highlights = (site: string, range: Range) => memo(`records:${site}:${range}`, ttlFor(range), () => highlightsQuery(site, range));
async function highlightsQuery(site: string, range: Range): Promise<Highlights> {
  const hours = range === 1 ? 24 : range * 24;
  const since = sql`now() - make_interval(hours => ${hours})`;
  const [[flip], [playerWin], [houseFlip], [houseJackpot]] = await Promise.all([
    rows(sql`${flipSelect} WHERE c.site = ${site} AND c.status = 'Ended' AND c.created_at >= ${since} ORDER BY c.pot_usd DESC NULLS LAST LIMIT 1`),
    rows(sql`
      SELECT b.game, b.round_id, b.player_id, b.settled_at, b.placed_at, b.payout_usd - b.wagered_usd AS win, p.display_name, p.avatar
      FROM bets b LEFT JOIN players p ON p.site = b.site AND p.external_id = b.player_id
      WHERE b.site = ${site} AND NOT b.is_house AND b.settled_at IS NOT NULL AND b.placed_at >= ${since}
      ORDER BY win DESC LIMIT 1`),
    rows(sql`${flipSelect} WHERE c.site = ${site} AND c.status = 'Ended' AND c.created_at >= ${since} ORDER BY c.house_net_usd DESC NULLS LAST LIMIT 1`),
    rows(sql`
      SELECT j.external_id, j.settled_at, j.created_at, j.pot_usd, j.house_net_usd, j.winner_id, j.meta->>'winnerName' winner_name_meta, p.display_name winner_name, p.avatar winner_avatar
      FROM jackpots j LEFT JOIN players p ON p.site = j.site AND p.external_id = j.winner_id
      WHERE j.site = ${site} AND j.status = 'Ended' AND j.created_at >= ${since}
      ORDER BY j.house_net_usd DESC NULLS LAST LIMIT 1`),
  ]);

  const biggestFlip = flip ? flipHighlight(flip, n(flip.pot_usd)) : null;

  const biggestPlayerWin: Highlight | null = playerWin
    ? {
        amount: n(playerWin.win),
        at: iso(playerWin.settled_at ?? playerWin.placed_at),
        game: String(playerWin.game) === "jackpot" ? "jackpot" : "coinflip",
        roundId: str(playerWin.round_id) ?? "",
        caption: `${str(playerWin.display_name) ?? String(playerWin.player_id)} on ${gameLabel(String(playerWin.game)).toLowerCase()}`,
        players: [who(playerWin.display_name, playerWin.player_id, playerWin.avatar, false)],
      }
    : null;

  const houseFlipNet = houseFlip ? n(houseFlip.house_net_usd) : -Infinity;
  const houseJackpotNet = houseJackpot ? n(houseJackpot.house_net_usd) : -Infinity;
  let biggestSiteWin: Highlight | null = null;
  if (houseFlip && houseFlipNet >= houseJackpotNet) {
    const h = flipHighlight(houseFlip, houseFlipNet);
    const houseWon = h.players.some((p) => p.house && h.caption.startsWith(p.name));
    biggestSiteWin = { ...h, caption: houseWon ? h.caption : `Tax on ${h.caption}` };
  } else if (houseJackpot) {
    const winner = who(houseJackpot.winner_name ?? houseJackpot.winner_name_meta, houseJackpot.winner_id ?? "?", houseJackpot.winner_avatar, false);
    biggestSiteWin = {
      amount: houseJackpotNet,
      at: iso(houseJackpot.settled_at ?? houseJackpot.created_at),
      game: "jackpot",
      roundId: String(houseJackpot.external_id),
      caption: `Tax on a ${moneyForCaption(n(houseJackpot.pot_usd))} jackpot won by ${winner.name}`,
      players: [winner],
    };
  }
  return { biggestFlip, biggestPlayerWin, biggestSiteWin };
}

const moneyForCaption = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
