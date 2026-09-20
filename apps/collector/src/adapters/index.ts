import type { SiteAdapter } from "../core/adapter.js";
import { banditcamp } from "./banditcamp/index.js";
import { cases, casesCrash } from "./cases/index.js";
import { clash, clashCrash } from "./clash/index.js";
import { csgoroll } from "./csgoroll/index.js";
import { csgogem } from "./csgogem/index.js";
import { rusteasy } from "./rusteasy/index.js";
import { rustmagic } from "./rustmagic/index.js";
import { rustbattle } from "./rustbattle/index.js";
import { rustclash, rustclashCrash } from "./rustclash/index.js";
import { rustyloot } from "./rustyloot/index.js";
import { splits } from "./splits/index.js";
import { rustypot } from "./rustypot/index.js";

/** A site is one adapter, or several when it spreads its feeds over more than one socket. */
export const ADAPTERS: Record<string, SiteAdapter | SiteAdapter[]> = { rustypot, csgogem, cases: [cases, casesCrash], clash: [clash, clashCrash], rustclash: [rustclash, rustclashCrash], rusteasy, banditcamp, rustmagic, rustyloot, csgoroll, splits, rustbattle };

export const adaptersFor = (site: string): SiteAdapter[] => {
  const a = ADAPTERS[site];
  return !a ? [] : Array.isArray(a) ? a : [a];
};
