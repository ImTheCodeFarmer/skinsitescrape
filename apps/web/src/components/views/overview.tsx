"use client";

import Link from "next/link";
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUpRight, Link2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { Reveal, Stagger } from "@/components/reveal";
import { CasinoLogo } from "@/components/casino-logo";
import { PlayerAvatar, profileHref } from "@/components/player-link";
import { Sparkline } from "@/components/sparkline";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CompareChart } from "@/components/charts/compare-chart";
import { NetChart } from "@/components/charts/net-chart";
import { count, countShort, money, moneyShort, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GameStat, PlayerStat, Point, Range, SiteCard, Summary } from "@/lib/types";
import { useLiveOverview } from "@/lib/live-client";

export type OverviewData = {
  range: Range;
  sites: SiteCard[];
  totals: Summary;
  agg: Point[];
  series: Record<string, Point[]>;
  games: GameStat[];
  players: (PlayerStat & { site: string })[];
  /** When the server produced these props; the live poll starts from here. */
  renderedAt: string;
  /** Placeholder numbers behind a sign-in overlay: never poll. */
  locked?: boolean;
};

const rangeLabel = (r: Range) => (r === 1 ? "last 24 hours" : `last ${r} days`);

type SortKey = "wagered" | "net" | "rtp";
/** Leaderboard columns. Each sorts descending; a site with no data sorts last. */
const SORTS: Record<SortKey, { label: string; title: string; value: (s: Summary | null | undefined) => number }> = {
  wagered: { label: "Wagered", title: "Total wagered by players", value: (s) => s?.wagered ?? -Infinity },
  net: { label: "Profit", title: "Site profit: wagered minus paid out", value: (s) => s?.net ?? -Infinity },
  rtp: { label: "Realized RTP", title: "Paid out as a share of wagered, over the range", value: (s) => (s?.wagered ? s.rtp : -Infinity) },
};

function SortHeader({ k, sort, onSort, className }: { k: SortKey; sort: SortKey; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      title={SORTS[k].title}
      aria-pressed={active}
      className={cn(
        "inline-flex w-full items-center justify-end gap-1 rounded-sm text-[11px] font-medium uppercase tracking-wide transition-[color] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {SORTS[k].label}
      <ArrowDown className={cn("size-3 shrink-0 transition-[opacity] duration-150 ease-out", active ? "opacity-100" : "opacity-0")} strokeWidth={2} aria-hidden />
    </button>
  );
}

export function OverviewView(initial: OverviewData) {
  const { range, sites, totals: s, agg, series, games, players } = useLiveOverview(initial);
  const tracked = sites.filter((x) => x.tracked);
  const [sort, setSort] = React.useState<SortKey>("wagered");
  const ranked = [...tracked].sort((a, b) => SORTS[sort].value(b.summary) - SORTS[sort].value(a.summary));
  const gameMax = games[0]?.wagered ?? 1;
  const metaOf = (slug: string) => sites.find((x) => x.meta.slug === slug)?.meta;

  return (
    <Stagger className="mx-auto flex max-w-7xl flex-col gap-5">
      <Reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All sites</h1>
          <p className="text-sm text-muted-foreground">
            Combined activity across {tracked.length} tracked {tracked.length === 1 ? "casino" : "casinos"}, {rangeLabel(range)}.
            {sites.length - tracked.length > 0 ? ` ${sites.length - tracked.length} more coming soon.` : ""}
          </p>
        </div>
      </Reveal>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total wagered" value={s.wagered} format={money} hint={s.bets ? `${count(s.bets)} bets · ${money(s.wagered / s.bets)} average bet` : `${count(s.bets)} bets`} />
        <KpiCard label="House profit" value={s.profit} format={money} hint={range === 1 ? "House take across winning hours" : "House take across winning days"} tone="good" />
        <KpiCard label="Players" value={s.players} format={count} hint={s.players ? `${(s.bets / s.players).toFixed(1)} bets per player` : "No settled bets yet"} />
        <KpiCard label="Net" value={s.net} format={money} hint={`${s.rtp.toFixed(1)}% returned to players`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Reveal className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Wager by site</CardTitle>
              <CardDescription>Stacked, {rangeLabel(range)}</CardDescription>
            </CardHeader>
            <CardContent>
              <CompareChart sites={tracked.map((x) => x.meta)} series={series} hourly={range === 1} />
            </CardContent>
          </Card>
        </Reveal>
        <Reveal className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Combined house net</CardTitle>
              <CardDescription>Green paid the house, red paid players</CardDescription>
            </CardHeader>
            <CardContent>
              <NetChart data={agg} hourly={range === 1} />
            </CardContent>
          </Card>
        </Reveal>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Reveal className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Leaderboard</CardTitle>
              <CardDescription>Sites ranked by wager volume</CardDescription>
            </CardHeader>
            <CardContent className="px-2">
              <div role="row" className="grid grid-cols-[1.5rem_auto_1fr_5.5rem] items-center gap-3 px-3 pb-1.5 sm:grid-cols-[1.5rem_auto_1fr_8rem_5.5rem_4.5rem_6rem]">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">#</span>
                <span aria-hidden className="w-[30px]" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Site</span>
                <span aria-hidden className="hidden sm:block" />
                <SortHeader k="wagered" sort={sort} onSort={setSort} />
                <SortHeader k="net" sort={sort} onSort={setSort} className="hidden sm:inline-flex" />
                <SortHeader k="rtp" sort={sort} onSort={setSort} className="hidden sm:inline-flex" />
              </div>
              <ul className="flex flex-col">
                {ranked.map(({ meta: c, summary: s, spark }, i) => (
                  <li key={c.slug}>
                    <Link href={`/casino/${c.slug}?range=${range}`} className="group grid grid-cols-[1.5rem_auto_1fr_5.5rem] items-center gap-3 rounded-sm px-3 py-2.5 transition-[background-color] duration-150 ease-out hover:bg-muted/60 sm:grid-cols-[1.5rem_auto_1fr_8rem_5.5rem_4.5rem_6rem]">
                      <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <CasinoLogo casino={c} size={30} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-sm font-medium">
                          {c.name}
                          <ArrowUpRight className="size-3 scale-[0.25] text-muted-foreground opacity-0 blur-[4px] transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover:scale-100 group-hover:opacity-100 group-hover:blur-0" />
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{c.tagline}</span>
                      </span>
                      <span className="hidden sm:block"><Sparkline data={spark} color={c.color} height={26} /></span>
                      <span className={cn("min-w-14 text-right", sort === "wagered" && "text-foreground")}>
                        <span className="block text-sm font-medium tabular-nums">{moneyShort(s?.wagered ?? 0)}</span>
                        <span className="block text-[11px] text-muted-foreground">{countShort(s?.players ?? 0)} players</span>
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn("hidden min-w-14 cursor-default text-right text-xs font-medium tabular-nums sm:block", (s?.net ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {(s?.net ?? 0) >= 0 ? "+" : "−"}{moneyShort(Math.abs(s?.net ?? 0))}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Site profit, {rangeLabel(range)}: wagered minus paid out. {(s?.net ?? 0) >= 0 ? "The house is ahead." : "Players are ahead."}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn("hidden min-w-14 cursor-default text-right text-xs tabular-nums sm:block", sort === "rtp" ? "font-medium text-foreground" : "text-muted-foreground")}>
                            {s?.wagered ? `${s.rtp.toFixed(1)}%` : "—"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Realized RTP, {rangeLabel(range)}: paid out as a share of wagered. {s?.wagered ? (s.rtp >= 100 ? "Players took out more than they put in." : `The site kept ${(100 - s.rtp).toFixed(1)}%.`) : "No bets in range."}
                        </TooltipContent>
                      </Tooltip>
                    </Link>
                  </li>
                ))}
                {sites.filter((x) => !x.tracked).map(({ meta: c }) => (
                  <li key={c.slug} className="grid grid-cols-[1.5rem_auto_1fr_auto] items-center gap-3 px-3 py-2.5 opacity-50">
                    <span className="text-xs text-muted-foreground">·</span>
                    <CasinoLogo casino={c} size={30} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{c.tagline}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">not tracked yet</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Top games</CardTitle>
              <CardDescription>Wager share across tracked sites</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {games.length === 0 ? <p className="text-sm text-muted-foreground">No settled bets in this range yet.</p> : null}
              {games.map((g) => (
                <div key={g.name}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{moneyShort(g.wagered)} · {count(g.plays)} plays</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-foreground/70 transition-[width] duration-500 ease-out" style={{ width: `${(g.wagered / gameMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </Reveal>
      </div>

      <Reveal>
        <Card>
          <CardHeader>
            <CardTitle>Biggest bettors</CardTitle>
            <CardDescription>Highest wager across all tracked sites, {rangeLabel(range)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {players.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : null}
            <AnimatePresence initial={false}>
            {players.map((p, i) => {
              const m = metaOf(p.site);
              return (
                <motion.div key={`${p.site}-${p.id}`} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: "easeOut" } }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
                <Link href={`${profileHref(p.site, p.id)}?range=${range}`} title={`${p.handle}'s profile`} className="group/player flex items-center gap-3 rounded-lg px-3 py-2.5 shadow-border transition-[background-color,box-shadow] duration-150 ease-out hover:bg-muted/60 hover:shadow-border-hover">
                  <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <PlayerAvatar name={p.handle} avatar={p.avatar} color={m?.color ?? "#888"} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate group-hover/player:underline">{p.handle}</span><Link2 aria-hidden className="size-3 shrink-0 text-muted-foreground opacity-60 transition-[opacity] duration-150 ease-out group-hover/player:opacity-100" strokeWidth={1.5} /></span>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-1.5 rounded-full" style={{ background: m?.color }} />
                      {m?.name ?? p.site} · {count(p.bets)} bets
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-medium tabular-nums">{moneyShort(p.wagered)}</span>
                    <span className={cn("block text-[11px] tabular-nums", p.net >= 0 ? "text-emerald-400" : "text-rose-400")}>{pct(p.net / p.wagered)}</span>
                  </span>
                </Link>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </CardContent>
        </Card>
      </Reveal>
    </Stagger>
  );
}
