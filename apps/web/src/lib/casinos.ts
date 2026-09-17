import LOGO_COLORS from "./logo-colors.json";
import type { CasinoMeta } from "./types";

const color = (slug: string) => LOGO_COLORS[slug as keyof typeof LOGO_COLORS];

/** Static metadata for every site we intend to track. Stats come from the database. */
export const CASINOS: CasinoMeta[] = [
  { slug: "rustypot", name: "Rustypot", url: "https://rustypot.com", logo: "/logos/rustypot.png", color: color("rustypot"), tagline: "Jackpot and coinflip", founded: 2020, currency: "USD", pots: true },
  { slug: "clash", name: "Clash.gg", url: "https://clash.gg", logo: "/logos/clash.png", color: color("clash"), tagline: "Battles, double, plinko, champion and crash", founded: 2022, currency: "USD", untracked: "Case openings, the upgrader, mines and tiles are not tracked: their only public feed is a wins ticker. Gems are converted at $0.60.", roundUrls: { battles: "https://clash.gg/battles/{id}" } },
  { slug: "rustclash", name: "RustClash", url: "https://rustclash.com", logo: "/logos/rustclash.png", color: color("rustclash"), tagline: "Rust skins, battles, roulette", founded: 2022, currency: "USD" },
  { slug: "rustyloot", name: "Rustyloot", url: "https://rustyloot.gg", logo: "/logos/rustyloot.png", color: color("rustyloot"), tagline: "Roulette, crash and jackpot", founded: 2021, currency: "Coins" },
  { slug: "cases", name: "Cases.gg", url: "https://cases.gg", logo: "/logos/cases.png", color: color("cases"), tagline: "Case battles, coinflip and crash", founded: 2023, currency: "USD", untracked: "Mystery box openings and the upgrader are not tracked: they have no public feed.", roundUrls: { battles: "https://cases.gg/case-battles/{id}" } },
  { slug: "rusteasy", name: "RustEasy", url: "https://www.rusteasy.com", logo: "/logos/rusteasy.png", color: color("rusteasy"), tagline: "Battles, coinflip, jackpot, double, champion", founded: 2021, currency: "USD", untracked: "Cases, upgrader, mines and bust are not tracked: they are private games with no public feed.", roundUrls: { battles: "https://www.rusteasy.com/casebattles/{id}" } },
  { slug: "csgogem", name: "CSGOGem", url: "https://csgogem.com", logo: "/logos/csgogem.png", color: color("csgogem"), tagline: "Case battles, slide and double", founded: 2019, currency: "Coins", untracked: "Upgrader, mines, tiles and cases are not tracked: the public feed only shows wins, or nothing at all.", roundUrls: { battles: "https://csgogem.com/games/battles/{id}" } },
  { slug: "banditcamp", name: "Bandit.camp", url: "https://bandit.camp", logo: "/logos/banditcamp.png", color: color("banditcamp"), tagline: "Crate battles, royale, wheel, spinners and unboxing", founded: 2021, currency: "Coins", untracked: "Minefield Madness, the Scrap Upgrader and Beancan Blast are not tracked: their only public feed is a wins ticker. Crate openings come from a ticker that runs about 40 minutes behind.", roundUrls: { battles: "https://bandit.camp/crate-battles/{id}" } },
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
  royale: "Crate Royale",
  wheel: "Wheel of Fortune",
  spinners: "Spinner Battles",
};
/** Link to a round on the site itself, when the site has a page for it. */
export const roundUrl = (meta: CasinoMeta | undefined, game: string, roundId: string | null | undefined) => {
  const tpl = roundId ? meta?.roundUrls?.[game] : undefined;
  return tpl ? tpl.replace("{id}", encodeURIComponent(roundId!)) : null;
};
export const gameLabel = (g: string) => GAME_LABELS[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
