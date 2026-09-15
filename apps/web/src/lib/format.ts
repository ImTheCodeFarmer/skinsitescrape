const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const num = new Intl.NumberFormat("en-US");
const numCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const money = (n: number) => usd.format(n);
export const moneyShort = (n: number) => usdCompact.format(n);
export const count = (n: number) => num.format(n);
export const countShort = (n: number) => numCompact.format(n);
export const pct = (n: number, digits = 1) => {
  const v = n * 100;
  if (Math.abs(v) < 0.5 * 10 ** -digits) return `${(0).toFixed(digits)}%`;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
};

export function dayLabel(iso: string) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function dateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

export function hourLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
}
