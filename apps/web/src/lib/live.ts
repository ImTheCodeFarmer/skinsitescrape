import "server-only";
import { getCasinoMeta } from "./casinos";
import { betsSince, highlights, profitBreakdown, roundsSince, seriesTail, siteCards, summary, topGames, topPlayers } from "./queries";
import type { LiveCasino, LiveOverview, Range } from "./types";

/**
 * What a live tick fetches. Everything here is either a handful of rows out
 * of the continuous aggregates, a memoized query, or rounds newer than the
 * client's cursor, so a tick costs a few milliseconds of database time and a
 * few kilobytes on the wire no matter how long the range is.
 */
export async function liveCasino(site: string, range: Range, since: string): Promise<LiveCasino> {
  const pots = Boolean(getCasinoMeta(site)?.pots);
  const [s, tail, games, players, breakdown, records, rounds, bets] = await Promise.all([
    summary(site, range),
    seriesTail(site, range),
    topGames(site, range),
    topPlayers(site, range, 10),
    pots ? profitBreakdown(site, range) : null,
    highlights(site, range),
    pots ? roundsSince(site, range, since) : { flips: [], pots: [] },
    pots ? [] : betsSince(site, range, since),
  ]);
  return { at: new Date().toISOString(), summary: s, tail, games, players, breakdown, records, flips: rounds.flips, pots: rounds.pots, bets };
}

export async function liveOverview(range: Range): Promise<LiveOverview> {
  const sites = await siteCards(range);
  const tracked = sites.filter((x) => x.tracked).map((x) => x.meta.slug);
  const [totals, aggTail, games, players, ...tails] = await Promise.all([
    summary(null, range),
    seriesTail(null, range),
    topGames(null, range),
    topPlayers(null, range, 8),
    ...tracked.map((slug) => seriesTail(slug, range)),
  ]);
  return { at: new Date().toISOString(), sites, totals, aggTail, siteTails: Object.fromEntries(tracked.map((slug, i) => [slug, tails[i]])), games, players };
}
