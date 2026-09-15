"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CasinoLogo } from "@/components/casino-logo";
import { KpiCard } from "@/components/kpi-card";
import { Reveal, Stagger } from "@/components/reveal";
import { WagerChart } from "@/components/charts/wager-chart";
import { NetChart } from "@/components/charts/net-chart";
import { GameShare } from "@/components/charts/game-share";
import { TopPlayersTable } from "@/components/top-players-table";
import { RoundsTable } from "@/components/rounds-table";
import { ProfitBreakdownCard } from "@/components/profit-breakdown";
import { HighlightsCard } from "@/components/highlights";
import { useLiveCasino } from "@/lib/live-client";
import { count, countShort, money, moneyShort } from "@/lib/format";
import type { CasinoMeta, CoinflipRound, GameStat, Highlights, JackpotRound, PlayerStat, Point, ProfitBreakdown, Range, SiteStatus, Summary } from "@/lib/types";

export type CasinoData = {
  meta: CasinoMeta;
  range: Range;
  tracked: boolean;
  summary: Summary | null;
  series: Point[];
  players: PlayerStat[];
  games: GameStat[];
  status: SiteStatus | null;
  flips: CoinflipRound[];
  pots: JackpotRound[];
  breakdown: ProfitBreakdown | null;
  records: Highlights | null;
  /** When the server produced these props; the live poll starts from here. */
  renderedAt: string;
};

const RANGE_LABEL: Record<Range, string> = { 1: "last 24 hours", 7: "last 7 days", 30: "last 30 days", 90: "last 90 days" };

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function CasinoView(initial: CasinoData) {
  const { meta: casino, range, tracked, summary: s, series, players, games, status, flips, pots, breakdown, records } = useLiveCasino(initial);
  const hourly = range === 1;
  const best = series.length ? [...series].sort((a, b) => b.wagered - a.wagered)[0] : null;
  const worst = series.length ? [...series].sort((a, b) => a.net - b.net)[0] : null;

  return (
    <Stagger className="mx-auto flex max-w-7xl flex-col gap-5" key={`${casino.slug}-${range}`}>
      <Reveal>
        <Card className="relative overflow-hidden">
          <span aria-hidden className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full blur-3xl" style={{ background: casino.color, opacity: 0.12 }} />
          <CardContent className="flex flex-wrap items-center gap-5 py-2">
            <CasinoLogo casino={casino} size={64} className="rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{casino.name}</h1>
                <Badge variant="secondary" className="font-normal">est. {casino.founded}</Badge>
                <Badge variant="outline" className="font-normal">{casino.currency}</Badge>
                {status ? (
                  <Badge variant="outline" className={status.connected ? "border-emerald-500/30 text-emerald-400" : "border-rose-500/30 text-rose-400"}>
                    {status.connected ? `live · last event ${ago(status.lastEventAt)}` : `offline · last event ${ago(status.lastEventAt)}`}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{casino.tagline}</p>
            </div>
            {s ? (
              <div className="hidden gap-6 text-sm md:flex">
                <Stat label="Players" value={countShort(s.players)} />
                <Stat label="Bets" value={countShort(s.bets)} />
                <Stat label="RTP" value={`${s.rtp.toFixed(1)}%`} />
              </div>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <a href={casino.url} target="_blank" rel="noreferrer">Visit <ExternalLink className="size-3.5" /></a>
            </Button>
          </CardContent>
        </Card>
      </Reveal>

      {!tracked || !s ? (
        <Reveal>
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No collector is running for {casino.name} yet. Stats will appear here once its feed is connected.
            </CardContent>
          </Card>
        </Reveal>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Wagered" value={s.wagered} format={money} delta={s.deltaWager ?? undefined} accent={casino.color} />
            <KpiCard label="Profit" value={s.profit} format={money} hint={hourly ? "House take across winning hours" : "House take across winning days"} tone="good" />
            <KpiCard label="Loss" value={s.loss} format={money} hint={hourly ? "Paid out across losing hours" : "Paid out across losing days"} tone="bad" />
            <KpiCard label="Net" value={s.net} format={money} delta={s.deltaNet ?? undefined} hint={s.wagered ? `${((s.net / s.wagered) * 100).toFixed(2)}% realized edge` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
          <Reveal className="lg:col-span-3">
            <Card className="h-full">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>
                    {best ? `Peak ${hourly ? "hour" : "day"} ${moneyShort(best.wagered)}` : "No activity in range"}
                    {worst && worst.net < 0 ? ` · worst ${hourly ? "hour" : "day"} −${moneyShort(Math.abs(worst.net))}` : ""}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="wager">
                  <TabsList className="mb-3 h-8">
                    <TabsTrigger value="wager" className="text-xs">Wager</TabsTrigger>
                    <TabsTrigger value="net" className="text-xs">Profit / loss</TabsTrigger>
                  </TabsList>
                  <TabsContent value="wager"><WagerChart data={series} color={casino.color} id={casino.slug} hourly={hourly} /></TabsContent>
                  <TabsContent value="net"><NetChart data={series} hourly={hourly} /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </Reveal>
          {breakdown ? <Reveal className="lg:col-span-2"><ProfitBreakdownCard data={breakdown} color={casino.color} /></Reveal> : null}
          </div>

          {records ? <Reveal><HighlightsCard data={records} color={casino.color} rangeLabel={RANGE_LABEL[range]} /></Reveal> : null}

          <div className="grid gap-4 lg:grid-cols-5">
            <Reveal className="lg:col-span-3">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Top players</CardTitle>
                  <CardDescription>By total wagered in range</CardDescription>
                </CardHeader>
                <CardContent className="px-2"><TopPlayersTable players={players} color={casino.color} rangeDays={range === 1 ? undefined : range} /></CardContent>
              </Card>
            </Reveal>
            <Reveal className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Top games</CardTitle>
                  <CardDescription>{count(games.reduce((a, g) => a + g.plays, 0))} settled bets across {games.length} {games.length === 1 ? "game" : "games"}</CardDescription>
                </CardHeader>
                <CardContent>
                  {games.length ? <GameShare games={games} color={casino.color} /> : <p className="text-sm text-muted-foreground">Nothing settled yet.</p>}
                </CardContent>
              </Card>
            </Reveal>
          </div>

          <Reveal>
            <Card>
              <CardHeader>
                <CardTitle>Recent rounds</CardTitle>
                <CardDescription>Latest settled games in range, newest first</CardDescription>
              </CardHeader>
              <CardContent className="px-2">
                <RoundsTable flips={flips} pots={pots} color={casino.color} />
              </CardContent>
            </Card>
          </Reveal>
        </>
      )}
    </Stagger>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
