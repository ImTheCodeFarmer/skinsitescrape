import { getCasinoMeta } from "./casinos";
import { settled } from "./memo";
import { highlights, profitBreakdown, recentBets, recentCoinflips, recentJackpots, series, siteCards, summary, topGames, topPlayers, trackedSites } from "./queries";
import type { Range } from "./types";

/**
 * Keeps the query memo warm for what the overview, site pages and sidebar
 * render on the 24h and 7d ranges, so no visitor waits on a cold query. Each
 * pass calls the memoized queries exactly as the pages do; entries still
 * fresh cost nothing, stale ones refresh here instead of on a request. 30d
 * and 90d fill on demand: they only read the daily rollups.
 *
 * Work goes one page at a time and waits for its refreshes to land, so a pass
 * never takes more than a page's worth of the connection pool from visitors.
 */
const RANGES: Range[] = [1, 7];
const EVERY_MS = 10_000;

function sitePage(site: string, range: Range) {
  const pots = Boolean(getCasinoMeta(site)?.pots);
  return [
    summary(site, range),
    series(site, range),
    topPlayers(site, range, 10),
    topGames(site, range),
    highlights(site, range),
    ...(pots ? [recentCoinflips(site, range), recentJackpots(site, range), profitBreakdown(site, range)] : [recentBets(site, range)]),
  ];
}

const overview = (range: Range) => [siteCards(range), summary(null, range), series(null, range), topGames(null, range), topPlayers(null, range, 8)];

async function pass() {
  const sites = await trackedSites();
  for (const range of RANGES) {
    for (const page of [() => overview(range), ...sites.map((site) => () => sitePage(site, range))]) {
      await Promise.all(page());
      await settled();
    }
  }
}

export function startWarming() {
  const g = globalThis as unknown as { __cacheWarmer?: boolean };
  if (g.__cacheWarmer) return;
  g.__cacheWarmer = true;
  const loop = async () => {
    const started = Date.now();
    try {
      await pass();
    } catch (err) {
      console.error("[warm] pass failed", err);
    }
    setTimeout(loop, Math.max(1_000, EVERY_MS - (Date.now() - started))).unref();
  };
  void loop();
}
