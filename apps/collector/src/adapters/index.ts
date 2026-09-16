import type { SiteAdapter } from "../core/adapter.js";
import { cases, casesCrash } from "./cases/index.js";
import { csgogem } from "./csgogem/index.js";
import { rusteasy } from "./rusteasy/index.js";
import { rustypot } from "./rustypot/index.js";

/** A site is one adapter, or several when it spreads its feeds over more than one socket. */
export const ADAPTERS: Record<string, SiteAdapter | SiteAdapter[]> = { rustypot, csgogem, cases: [cases, casesCrash], rusteasy };

export const adaptersFor = (site: string): SiteAdapter[] => {
  const a = ADAPTERS[site];
  return !a ? [] : Array.isArray(a) ? a : [a];
};
