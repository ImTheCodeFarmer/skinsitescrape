import "server-only";
import { sql } from "@casino/db";
import { db } from "./db";
import { CASINOS, gameLabel } from "./casinos";
import type { CoinflipRound, GameStat, JackpotRound, PlayerStat, Point, Range, SiteCard, SiteStatus, Summary } from "./types";

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
 * Time series for one site (or all sites when `site` is null). 24h uses the
 * hourly aggregate; longer ranges use daily buckets computed from bets so the
 * distinct-player count is exact per day.
 */
export async function series(site: string | null, range: Range, offsetWindows = 0): Promise<Point[]> {
  const hours = range === 1 ? 24 : range * 24;
  const to = sql`now() - make_interval(hours => ${hours * offsetWindows})`;
  const from = sql`now() - make_interval(hours => ${hours * (offsetWindows + 1)})`;
  const siteFilter = site ? sql`AND site = ${site}` : sql``;
  const r =
    range === 1
      ? await rows(sql`
          SELECT bucket AS t, sum(wagered_usd) wagered, sum(house_net_usd) net, sum(players) players, sum(bets) bets
          FROM bets_hourly WHERE bucket >= ${from} AND bucket < ${to} ${siteFilter}
          GROUP BY bucket ORDER BY bucket`)
      : await rows(sql`
          SELECT time_bucket('1 day', placed_at) AS t,
                 sum(wagered_usd) wagered, sum(wagered_usd - payout_usd) net,
                 count(DISTINCT player_id) players, count(*) bets
          FROM bets WHERE settled_at IS NOT NULL AND NOT is_house
            AND placed_at >= ${from} AND placed_at < ${to} ${siteFilter}
          GROUP BY 1 ORDER BY 1`);
  return r.map((x) => ({ t: new Date(x.t as string).toISOString(), wagered: n(x.wagered), net: n(x.net), players: n(x.players), bets: n(x.bets) }));
}

async function totals(site: string | null, range: Range, offsetWindows = 0) {
  const hours = range === 1 ? 24 : range * 24;
  const siteFilter = site ? sql`AND site = ${site}` : sql``;
  const [r] = await rows(sql`
    SELECT coalesce(sum(wagered_usd),0) wagered, coalesce(sum(payout_usd),0) payout,
           count(DISTINCT player_id) players, count(*) bets
    FROM bets WHERE settled_at IS NOT NULL AND NOT is_house
      AND placed_at >= now() - make_interval(hours => ${hours * (offsetWindows + 1)})
      AND placed_at <  now() - make_interval(hours => ${hours * offsetWindows}) ${siteFilter}`);
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
  const hours = range === 1 ? 24 : range * 24;
  const siteFilter = site ? sql`AND site = ${site}` : sql``;
  const r = await rows(sql`
    SELECT game, sum(wagered_usd) wagered, count(*) plays, sum(wagered_usd - payout_usd) net
    FROM bets WHERE settled_at IS NOT NULL AND NOT is_house
      AND placed_at >= now() - make_interval(hours => ${hours}) ${siteFilter}
    GROUP BY game ORDER BY wagered DESC`);
  return r.map((x) => ({ name: gameLabel(String(x.game)), wagered: n(x.wagered), plays: n(x.plays), net: n(x.net) }));
}

export async function topPlayers(site: string | null, range: Range, limit = 10): Promise<(PlayerStat & { site: string })[]> {
  const hours = range === 1 ? 24 : range * 24;
  const siteFilter = site ? sql`AND b.site = ${site}` : sql``;
  const r = await rows(sql`
    WITH agg AS (
      SELECT b.site, b.player_id, sum(wagered_usd) wagered, sum(payout_usd - wagered_usd) net, count(*) bets,
             count(DISTINCT date_trunc('day', placed_at)) active_days,
             mode() WITHIN GROUP (ORDER BY game) favorite
      FROM bets b WHERE settled_at IS NOT NULL AND NOT is_house
        AND placed_at >= now() - make_interval(hours => ${hours}) ${siteFilter}
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

export async function recentCoinflips(site: string, range: Range, limit = 25): Promise<CoinflipRound[]> {
  const hours = range === 1 ? 24 : range * 24;
  const r = await rows(sql`
    SELECT c.external_id, c.created_at, c.settled_at, c.status, c.creator_id, c.creator_pick, c.creator_total,
           c.opponent_id, c.opponent_total, c.winner_id, c.winning_side, c.pot_usd, c.tax_usd, c.house_net_usd,
           pc.display_name creator_name, pc.avatar creator_avatar, coalesce(pc.is_house, false) creator_house,
           po.display_name opponent_name, po.avatar opponent_avatar, coalesce(po.is_house, false) opponent_house
    FROM coinflips c
    LEFT JOIN players pc ON pc.site = c.site AND pc.external_id = c.creator_id
    LEFT JOIN players po ON po.site = c.site AND po.external_id = c.opponent_id
    WHERE c.site = ${site} AND c.status = 'Ended' AND c.settled_at >= now() - make_interval(hours => ${hours})
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

export async function recentJackpots(site: string, range: Range, limit = 25): Promise<JackpotRound[]> {
  const hours = range === 1 ? 24 : range * 24;
  const r = await rows(sql`
    SELECT j.external_id, j.created_at, j.settled_at, j.pot_usd, j.entries, j.winner_id, j.winner_ticket, j.tax_usd, j.house_net_usd,
           j.meta->>'winnerChance' winner_chance, coalesce((j.meta->>'partial')::boolean, false) partial, j.meta->>'winnerName' winner_name_meta,
           p.display_name winner_name, p.avatar winner_avatar
    FROM jackpots j
    LEFT JOIN players p ON p.site = j.site AND p.external_id = j.winner_id
    WHERE j.site = ${site} AND j.status = 'Ended' AND j.pot_usd IS NOT NULL AND j.settled_at >= now() - make_interval(hours => ${hours})
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
