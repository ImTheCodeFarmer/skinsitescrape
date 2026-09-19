"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Link2 } from "lucide-react";
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

export function OverviewView(initial: OverviewData) {
  const { range, sites, totals: s, agg, series, games, players } = useLiveOverview(initial);
  const tracked = sites.filter((x) => x.tracked);
  const ranked = [...tracked].sort((a, b) => (b.summary?.wagered ?? 0) - (a.summary?.wagered ?? 0));
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
        <KpiCard label="Total wagered" value={s.wagered} format={money} delta={s.deltaWager ?? undefined} hint={s.bets ? `${count(s.bets)} bets · ${money(s.wagered / s.bets)} average bet` : `${count(s.bets)} bets`} />
        <KpiCard label="House profit" value={s.profit} format={money} hint={range === 1 ? "House take across winning hours" : "House take across winning days"} tone="good" />
        <KpiCard label="Players" value={s.players} format={count} hint={s.players ? `${(s.bets / s.players).toFixed(1)} bets per player` : "No settled bets yet"} />
        <KpiCard label="Net" value={s.net} format={money} delta={s.deltaNet ?? undefined} hint={`${s.rtp.toFixed(1)}% returned to players`} />
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
              <ul className="flex flex-col">
                {ranked.map(({ meta: c, summary: s, spark }, i) => (
                  <li key={c.slug}>
                    <Link href={`/casino/${c.slug}?range=${range}`} className="group grid grid-cols-[1.5rem_auto_1fr_auto] items-center gap-3 rounded-sm px-3 py-2.5 transition-[background-color] duration-150 ease-out hover:bg-muted/60 sm:grid-cols-[1.5rem_auto_1fr_8rem_auto_auto]">
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
                      <span className="text-right">
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
