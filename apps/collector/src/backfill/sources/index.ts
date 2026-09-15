import type { Source } from "../types.js";
import { rustypot } from "./rustypot.js";
import { casesBattles, clashBattles, rustclashBattles } from "./battles-clash.js";
import { csgogemBattles } from "./battles-csgogem.js";
import { rustylootBattles } from "./battles-rustyloot.js";
import { banditBattles, rustmagicBattles } from "./battles-bandit.js";
import { clashRoulette, rustclashRoulette } from "./roulette.js";
import { clashPlinko, rustclashPlinko } from "./plinko.js";

/** Order matters only for readability of the logs; every source is independent. */
export const SOURCES: Source[] = [
  rustypot,
  clashBattles,
  rustclashBattles,
  casesBattles,
  csgogemBattles,
  rustylootBattles,
  clashPlinko,
  rustclashPlinko,
  clashRoulette,
  rustclashRoulette,
  banditBattles,
  rustmagicBattles,
];

export const DEFAULT_SOURCES = SOURCES.filter((s) => !s.optIn).map((s) => s.name);
