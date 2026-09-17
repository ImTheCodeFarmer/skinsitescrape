/**
 * Unit conversions for legacy amounts. The legacy scraper stored each site's
 * native integer units (mostly cents of the site's coin). One USD per unit,
 * per site; override with BACKFILL_USD_<SITE>=0.006 etc.
 *
 * Established from the legacy dashboard's own SQL:
 *   clash, rustclash  cents of gems, 1 gem = $0.60   (rust_clash_case_battle_last7days_stats)
 *   cases             cents of USD                   (calculate_casesgg_case_battle_winnings)
 *   rustypot          USD already
 *   csgogem           cents of coins, 1 coin = $0.60 (the site's own USD fx
 *                     rate on its socket, app.onFxRateUpdate, 2026-09-15)
 *   banditcamp        hundredths of scrap, 1 scrap = $0.65 (the site's own
 *                     rate on its socket, app.conga
 *                     withdrawals.crypto.scrapRateUsd, 2026-09-17)
 *   rustmagic         hundredths of a coin, 1 coin = $0.66 (the site's FAQ,
 *                     2026-09-17)
 *   rustyloot         1.55 coins to the dollar (the site's deposit forms,
 *                     2026-09-17). The legacy rows look like cents of a
 *                     coin, which is an assumption: the live feed is in
 *                     thousandths.
 */
const DEFAULT_USD_PER_UNIT: Record<string, number> = {
  rustypot: 1,
  clash: 0.6 / 100,
  rustclash: 0.6 / 100,
  cases: 1 / 100,
  csgogem: 0.6 / 100,
  rustyloot: 1 / 1.55 / 100,
  banditcamp: 0.65 / 100,
  rustmagic: 0.66 / 100,
};

export function usdPerUnit(site: string): number {
  const env = process.env[`BACKFILL_USD_${site.toUpperCase()}`];
  if (env && Number.isFinite(Number(env))) return Number(env);
  return DEFAULT_USD_PER_UNIT[site] ?? 1;
}

export const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Converter from a site's legacy units to USD, rounded to the numeric(14,4) columns. */
export const moneyFor = (site: string) => {
  const k = usdPerUnit(site);
  return (v: unknown) => round4(num(v) * k);
};
export const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
export const date = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Group rows by a key column into arrays. */
export function groupBy<T extends Record<string, any>>(rows: T[], key: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}
export const uniq = <T>(xs: T[]) => [...new Set(xs)];
export const LEGACY_META = { legacy: true } as const;
