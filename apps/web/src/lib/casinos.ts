import LOGO_COLORS from "./logo-colors.json";
import type { CasinoMeta } from "./types";

const color = (slug: string) => LOGO_COLORS[slug as keyof typeof LOGO_COLORS];

/** Static metadata for every site we intend to track. Stats come from the database. */
export const CASINOS: CasinoMeta[] = [
  { slug: "rustypot", name: "Rustypot", url: "https://rustypot.com", logo: "/logos/rustypot.png", color: color("rustypot"), tagline: "Jackpot and coinflip", founded: 2020, currency: "USD" },
  { slug: "clash", name: "Clash.gg", url: "https://clash.gg", logo: "/logos/clash.png", color: color("clash"), tagline: "Case battles, upgrader, plinko", founded: 2022, currency: "USD" },
  { slug: "rustclash", name: "RustClash", url: "https://rustclash.com", logo: "/logos/rustclash.png", color: color("rustclash"), tagline: "Rust skins, battles, roulette", founded: 2022, currency: "USD" },
  { slug: "rustyloot", name: "Rustyloot", url: "https://rustyloot.gg", logo: "/logos/rustyloot.png", color: color("rustyloot"), tagline: "Roulette, crash and jackpot", founded: 2021, currency: "Coins" },
  { slug: "cases", name: "Cases.gg", url: "https://cases.gg", logo: "/logos/cases.png", color: color("cases"), tagline: "Case opening and battles", founded: 2023, currency: "USD" },
  { slug: "csgogem", name: "CSGOGem", url: "https://csgogem.com", logo: "/logos/csgogem.png", color: color("csgogem"), tagline: "Case battles, slide and double", founded: 2019, currency: "Coins", untracked: "Upgrader, mines, tiles and cases are not tracked: the public feed only shows wins, or nothing at all." },
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
};
export const gameLabel = (g: string) => GAME_LABELS[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
