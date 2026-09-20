import LOGO_COLORS from "./logo-colors.json";
import type { CasinoMeta } from "./types";

const color = (slug: string) => LOGO_COLORS[slug as keyof typeof LOGO_COLORS];

/** Static metadata for every site we intend to track. Stats come from the database. */
export const CASINOS: CasinoMeta[] = [
  { slug: "rustypot", name: "Rustypot", url: "https://rustypot.com", logo: "/logos/rustypot.png", color: color("rustypot"), tagline: "Jackpot and coinflip", founded: 2020, currency: "USD", conversion: { unit: "USD", usdPerUnit: 1, wire: "USD", source: "Site balances are USD." }, pots: true },
  { slug: "clash", name: "Clash.gg", url: "https://clash.gg", logo: "/logos/clash.png", color: color("clash"), tagline: "Battles, double, plinko, champion and crash", founded: 2022, currency: "USD", conversion: { unit: "gem", usdPerUnit: 0.6, wire: "cents of a gem", source: "The legacy dashboard's rate; item prices on the feed agree with Steam prices at $0.60." }, untracked: "Case openings, the upgrader, mines and tiles are not tracked: their only public feed is a wins ticker. Gems are converted at $0.60.", roundUrls: { battles: "https://clash.gg/battles/{id}" } },
  { slug: "rustclash", name: "RustClash", url: "https://rustclash.com", logo: "/logos/rustclash.png", color: color("rustclash"), tagline: "Case battles, double, plinko and crash", founded: 2022, currency: "USD", conversion: { unit: "gem", usdPerUnit: 0.6, wire: "cents of a gem", source: "Same platform and rate as Clash.gg: the legacy dashboard's rate, and what the feed's item prices give against Steam prices." }, untracked: "Case openings, the upgrader, mines, roll and tiles are not tracked: they are private games with no public feed. Gems are converted at $0.60.", roundUrls: { battles: "https://rustclash.com/battles/{id}" } },
  { slug: "rustyloot", name: "Rustyloot", url: "https://rustyloot.gg", logo: "/logos/rustyloot.png", color: color("rustyloot"), tagline: "Case battles, wheel, PVP mines and coinflip", founded: 2021, currency: "Coins", conversion: { unit: "coin", usdPerUnit: 0.6452, wire: "thousandths of a coin", source: "The site sells coins at 1.55 to the dollar (its deposit forms convert with usd × 1.55), so a coin is $1 / 1.55. One Polish payment route uses 1.5." }, untracked: "Plinko, the upgrader, mines and cases are not tracked: their only public feed is a bet ticker with no player or bet ids. The coinflip's fee is not on the feed.", roundUrls: { battles: "https://rustyloot.gg/battles/{id}" } },
  { slug: "cases", name: "Cases.gg", url: "https://cases.gg", logo: "/logos/cases.png", color: color("cases"), tagline: "Case battles, coinflip and crash", founded: 2023, currency: "USD", conversion: { unit: "USD", usdPerUnit: 1, wire: "cents of USD", source: "Site balances are USD." }, untracked: "Mystery box openings and the upgrader are not tracked: they have no public feed.", roundUrls: { battles: "https://cases.gg/case-battles/{id}" } },
  { slug: "rusteasy", name: "RustEasy", url: "https://www.rusteasy.com", logo: "/logos/rusteasy.png", color: color("rusteasy"), tagline: "Battles, coinflip, jackpot, double, champion", founded: 2021, currency: "USD", conversion: { unit: "gem", usdPerUnit: 1, wire: "gems", source: "Gems are 1:1 with USD on the site." }, untracked: "Cases, upgrader, mines and bust are not tracked: they are private games with no public feed.", roundUrls: { battles: "https://www.rusteasy.com/casebattles/{id}" } },
  { slug: "csgogem", name: "CSGOGem", url: "https://csgogem.com", logo: "/logos/csgogem.png", color: color("csgogem"), tagline: "Case battles, slide and double", founded: 2019, currency: "Coins", conversion: { unit: "coin", usdPerUnit: 0.6, wire: "cents of a coin", source: "The site's own USD rate on its socket (app.onFxRateUpdate), $0.60 on 2026-09-15.", live: true }, untracked: "Upgrader, mines, tiles and cases are not tracked: the public feed only shows wins, or nothing at all.", roundUrls: { battles: "https://csgogem.com/games/battles/{id}" } },
  { slug: "banditcamp", name: "Bandit.camp", url: "https://bandit.camp", logo: "/logos/banditcamp.png", color: color("banditcamp"), tagline: "Crate battles, royale, wheel, spinners and unboxing", founded: 2021, currency: "Coins", conversion: { unit: "scrap", usdPerUnit: 0.65, wire: "hundredths of a scrap", source: "The site's own cash-out rate on its socket (app.conga withdrawals.crypto.scrapRateUsd), $0.65 on 2026-09-17. Buying costs about $0.71 a scrap after the deposit bonus.", live: true }, untracked: "Minefield Madness, the Scrap Upgrader and Beancan Blast are not tracked: their only public feed is a wins ticker. Crate openings come from a ticker that runs about 40 minutes behind. Scrap is converted at $0.65.", roundUrls: { battles: "https://bandit.camp/crate-battles/{id}" } },
  { slug: "splits", name: "Splits.gg", url: "https://splits.gg", logo: "/logos/splits.png", color: color("splits"), tagline: "Battles, coinflip, bust, upgrader, wheel, mines, cases, targets, towers, keno and plinko", founded: 2023, currency: "USD", conversion: { unit: "gem", usdPerUnit: 1, wire: "cents of a gem", source: "The site's client shows every amount as cents / 100 gems and counts a USD deposit as the same number of gems; crypto deposits carry a bonus." }, untracked: "Everything on the site's live bet ticker is tracked, losses included. Players who play anonymously are stored as Anonymous." },
  { slug: "rustbattle", name: "RustBattle", url: "https://rustbattle.com", logo: "/logos/rustbattle.png", color: color("rustbattle"), tagline: "Case battles, coinflip, crash, upgrader, tower, mines, plinko, keno, 21 and cases", founded: 2022, currency: "Coins", conversion: { unit: "coin", usdPerUnit: 1, wire: "cents of a coin", source: "The site's own crypto rates on its socket (crypto:updated) price USDT at 0.9997 coins, so a coin is a dollar." }, untracked: "Upgrader, tower, mines, plinko, keno, 21 and case openings are not tracked: they are private games with no public feed.", roundUrls: { battles: "https://rustbattle.com/games/battles/{id}" } },
  { slug: "csgoroll", name: "CSGORoll", url: "https://www.csgoroll.com", logo: "/logos/csgoroll.png", color: color("csgoroll"), tagline: "PVP battles, roll, crash, dice, upgrader and case royale", founded: 2016, currency: "Coins", conversion: { unit: "coin", usdPerUnit: 0.7, wire: "decimal coins", source: "The site's own exchange rate query (ExchangeRateList, TKN to USD), $0.70 on 2026-09-18." }, untracked: "Case openings, Arms Dealer, Cluck 'n' Boom (mines), Plinko and esports are not tracked: openings, Arms Dealer and mines are private games whose only public trace is a big-win ticker, esports only pushes odds, and Plinko's feed refuses guests. Battles paid in box keys are not counted.", roundUrls: { battles: "https://www.csgoroll.com/battles/{id}" } },
  { slug: "rustmagic", name: "RustMagic", url: "https://rustmagic.com", logo: "/logos/rustmagic.png", color: color("rustmagic"), tagline: "Slots, battles, upgrader, mines, keno and more", founded: 2023, currency: "Coins", conversion: { unit: "coin", usdPerUnit: 0.66, wire: "hundredths of a coin", source: "The site's FAQ: \"1 coin on RustMagic equals $0.66\" (2026-09-17)." }, roundUrls: { battles: "https://rustmagic.com/case-battles/{id}" } },
];

export const getCasinoMeta = (slug: string) => CASINOS.find((c) => c.slug === slug);

export const GAME_LABELS: Record<string, string> = {
  coinflip: "Coinflip",
  jackpot: "Jackpot",
  crash: "Crash",
  roulette: "Roulette",
  mines: "Mines",
  plinko: "Plinko",
  cases: "Cases",
  battles: "Case Battles",
  upgrader: "Upgrader",
  dice: "Dice",
  slide: "Slide",
  keno: "Keno",
  champion: "Champion",
  pvpmines: "PVP Mines",
  flipper: "Flipper",
  slots: "Slots",
  royale: "Crate Royale",
  wheel: "Wheel of Fortune",
  spinners: "Spinner Battles",
  bust: "Bust (blackjack)",
  "skin-battles": "Skin Battles",
  "upgrader-battles": "Upgrader Battles",
  targets: "Targets",
  towers: "Towers",
  hilo: "Hi-Lo",
  "50x": "50x",
};
/** Link to a round on the site itself, when the site has a page for it. */
export const roundUrl = (meta: CasinoMeta | undefined, game: string, roundId: string | null | undefined) => {
  const tpl = roundId ? meta?.roundUrls?.[game] : undefined;
  return tpl ? tpl.replace("{id}", encodeURIComponent(roundId!)) : null;
};
export const gameLabel = (g: string) => GAME_LABELS[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
