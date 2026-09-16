import type { SiteAdapter } from "../core/adapter.js";
import { csgogem } from "./csgogem/index.js";
import { rustypot } from "./rustypot/index.js";

export const ADAPTERS: Record<string, SiteAdapter> = { rustypot, csgogem };
