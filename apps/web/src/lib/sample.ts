import { CASINOS, GAME_LABELS } from "@/lib/casinos";
import type { BetRow, CasinoMeta, CoinflipRound, GameStat, Highlight, Highlights, JackpotRound, PlayerStat, Point, ProfitBreakdown, Range, SiteCard, Summary } from "@/lib/types";

/**
 * Plausible-looking placeholder numbers for the pages a visitor is not
 * signed in to see. Deterministic per site and range (seeded), so the blur
 * does not flicker between renders. Nothing here touches the database.
 */

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function points(rand: () => number, range: Range, scale: number): Point[] {
  const n = range === 1 ? 24 : range;
  const step = range === 1 ? 3600_000 : 86400_000;
  const start = range === 1 ? new Date(Math.floor(Date.now() / 3600_000) * 3600_000 - 23 * step) : new Date(dayStart(new Date()).getTime() - (n - 1) * step);
  return Array.from({ length: n }, (_, i) => {
    const wagered = r2(scale * (0.6 + rand() * 0.8));
    return { t: new Date(start.getTime() + i * step).toISOString(), wagered, net: r2(wagered * (rand() * 0.16 - 0.04)), players: Math.round(20 + rand() * 60), bets: Math.round(wagered / (8 + rand() * 20)) };
  });
}

function summaryOf(series: Point[], rand: () => number): Summary {
  const wagered = r2(series.reduce((a, p) => a + p.wagered, 0));
  const profit = r2(series.reduce((a, p) => a + Math.max(0, p.net), 0));
  const loss = r2(series.reduce((a, p) => a + Math.max(0, -p.net), 0));
  const net = r2(profit - loss);
  const bets = series.reduce((a, p) => a + p.bets, 0);
  return {
    wagered, payout: r2(wagered - net), profit, loss, net,
    players: Math.round(series.reduce((a, p) => a + p.players, 0) / 3), bets,
    playerWins: r2(wagered * 0.42), playerLosses: r2(wagered * 0.42 + net),
    rtp: r2(100 - (net / Math.max(1, wagered)) * 100), deltaWager: r2(rand() * 0.4 - 0.15), deltaNet: r2(rand() * 0.6 - 0.3),
  };
}

const NAMES = ["Dusty", "Nomad", "Scrap King", "Boonie", "Radtown", "Quarry", "Lantern", "Outpost", "Cargo", "Bandit", "Rustic", "Salvage"];

function players(rand: () => number, n: number, wagered: number, site: string): (PlayerStat & { site: string })[] {
  return Array.from({ length: n }, (_, i) => {
    const w = r2((wagered * (0.08 - i * 0.005)) * (0.7 + rand() * 0.6));
    return { id: `sample-${i}`, handle: `${NAMES[i % NAMES.length]}${i + 1}`, avatar: null, wagered: w, net: r2(w * (rand() * 0.5 - 0.3)), bets: Math.round(w / 15), favorite: "battles", activeDays: Math.max(1, Math.round(rand() * 7)), site };
  });
}

function games(rand: () => number, wagered: number, keys: string[]): GameStat[] {
  let left = wagered;
  return keys.map((k, i) => {
    const w = i === keys.length - 1 ? left : r2(left * (0.35 + rand() * 0.3));
    left = r2(left - w);
    return { name: GAME_LABELS[k] ? k : k, wagered: w, plays: Math.round(w / 12), net: r2(w * (rand() * 0.12 - 0.02)) };
  });
}

function highlight(rand: () => number, game: string, amount: number, caption: string, at: Date): Highlight {
  return { amount: r2(amount * (0.8 + rand() * 0.4)), at: at.toISOString(), game, roundId: `sample-${Math.round(rand() * 1e6)}`, caption, players: [{ name: NAMES[Math.floor(rand() * NAMES.length)], avatar: null, house: false }] };
}

export function sampleOverview(range: Range) {
  const rand = rng(`overview:${range}`);
  const scale = 4200;
  const agg = points(rand, range, scale * CASINOS.length * 0.6);
  const totals = summaryOf(agg, rand);
  const series: Record<string, Point[]> = {};
  const sites: SiteCard[] = CASINOS.map((meta) => {
    const pts = points(rng(`${meta.slug}:${range}`), range, scale);
    series[meta.slug] = pts;
    return { meta, tracked: true, summary: summaryOf(pts, rand), spark: pts.slice(-7).map((p) => p.wagered), status: { site: meta.slug, connected: true, lastEventAt: new Date().toISOString(), lastConnectAt: new Date().toISOString(), reconnects: 0 } };
  });
  return { range, sites, totals, agg, series, games: games(rand, totals.wagered, ["battles", "coinflip", "crash", "roulette", "jackpot"]), players: players(rand, 8, totals.wagered, CASINOS[0].slug), renderedAt: new Date().toISOString(), locked: true as const };
}

export function sampleCasino(meta: CasinoMeta, range: Range) {
  const rand = rng(`${meta.slug}:${range}`);
  const series = points(rand, range, 4200);
  const summary = summaryOf(series, rand);
  const now = new Date();
  const at = (i: number) => new Date(now.getTime() - i * 137_000);
  const flips: CoinflipRound[] = meta.pots
    ? Array.from({ length: 12 }, (_, i) => {
        const total = r2(20 + rand() * 400);
        return { id: `sample-f${i}`, createdAt: at(i + 1).toISOString(), settledAt: at(i).toISOString(), status: "Ended", creator: { id: "a", name: NAMES[i % NAMES.length], avatar: null, house: false, total, pick: 0 }, opponent: { id: "b", name: NAMES[(i + 3) % NAMES.length], avatar: null, house: i % 3 === 0, total }, winnerId: i % 2 ? "a" : "b", winningSide: i % 2, pot: r2(total * 2), tax: r2(total * 0.2), houseNet: r2(total * 0.2) };
      })
    : [];
  const pots: JackpotRound[] = meta.pots
    ? Array.from({ length: 8 }, (_, i) => {
        const pot = r2(80 + rand() * 900);
        return { id: `sample-p${i}`, createdAt: at(i + 2).toISOString(), settledAt: at(i).toISOString(), pot, entries: 3 + Math.round(rand() * 8), winner: { id: "w", name: NAMES[(i + 5) % NAMES.length], avatar: null }, winnerChance: r2(10 + rand() * 60), ticket: Math.round(rand() * 1e6), tax: r2(pot * 0.1), houseNet: r2(pot * 0.1), partial: false };
      })
    : [];
  const bets: BetRow[] = meta.pots
    ? []
    : Array.from({ length: 15 }, (_, i) => {
        const wagered = r2(2 + rand() * 120);
        const won = rand() > 0.55;
        return { id: `sample-b${i}`, game: ["battles", "crash", "coinflip", "roulette"][i % 4], roundId: null, placedAt: at(i + 1).toISOString(), settledAt: at(i).toISOString(), player: { id: `p${i}`, name: NAMES[i % NAMES.length], avatar: null }, wagered, payout: won ? r2(wagered * (1.2 + rand() * 2)) : 0, won };
      });
  const breakdown: ProfitBreakdown | null = meta.pots ? { botWins: r2(summary.profit * 0.5), botLosses: -r2(summary.loss * 0.4), flipTax: r2(summary.profit * 0.3), jackpotTax: r2(summary.profit * 0.2), total: summary.net, houseFlips: 120, estimated: true } : null;
  const records: Highlights = {
    biggestFlip: meta.pots ? highlight(rand, "coinflip", 900, `${NAMES[1]} beat ${NAMES[2]}`, at(40)) : null,
    biggestPlayerWin: highlight(rand, "battles", 1800, `${NAMES[3]} won a battle`, at(60)),
    biggestSiteWin: highlight(rand, "battles", 700, `${NAMES[4]} lost a battle`, at(80)),
    biggestJackpot: meta.pots ? highlight(rand, "jackpot", 1400, `${NAMES[5]} took the pot`, at(90)) : null,
    longestShot: meta.pots ? { ...highlight(rand, "jackpot", 4, `${NAMES[6]} won at 4%`, at(100)), format: "count" } : null,
    longestStreak: meta.pots ? { ...highlight(rand, "coinflip", 7, `${NAMES[7]} won 7 in a row`, at(110)), format: "count" } : null,
    biggestBotLoss: meta.pots ? highlight(rand, "coinflip", 600, `${NAMES[8]} beat the bot`, at(120)) : null,
    peakHour: { ...highlight(rand, "hourly", 3200, "Busiest hour", at(200)), players: [] },
  };
  return {
    meta, range, tracked: true, summary, series,
    players: players(rand, 10, summary.wagered, meta.slug),
    games: games(rand, summary.wagered, meta.pots ? ["coinflip", "jackpot"] : ["battles", "coinflip", "crash", "roulette"]),
    status: { site: meta.slug, connected: true, lastEventAt: now.toISOString(), lastConnectAt: now.toISOString(), reconnects: 0 },
    flips, pots, bets, breakdown, records, renderedAt: now.toISOString(), locked: true as const,
  };
}
