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
import { BetsTable } from "@/components/bets-table";
import { GameNetCard, ProfitBreakdownCard } from "@/components/profit-breakdown";
import { HighlightsCard } from "@/components/highlights";
import { TimeAgo } from "@/components/time-ago";
import { useLiveCasino } from "@/lib/live-client";
import { count, countShort, money, moneyShort } from "@/lib/format";
import type { BetRow, CasinoMeta, CoinflipRound, GameStat, Highlights, JackpotRound, PlayerStat, Point, ProfitBreakdown, Range, SiteStatus, Summary } from "@/lib/types";

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
  /** Sites without pot games list settled bets instead of rounds. */
  bets: BetRow[];
  breakdown: ProfitBreakdown | null;
  records: Highlights | null;
  /** When the server produced these props; the live poll starts from here. */
  renderedAt: string;
  /** Placeholder numbers behind a sign-in overlay: never poll. */
  locked?: boolean;
};

const RANGE_LABEL: Record<Range, string> = { 1: "last 24 hours", 7: "last 7 days", 30: "last 30 days", 90: "last 90 days" };

export function CasinoView(initial: CasinoData) {
  const { meta: casino, range, tracked, summary: s, series, players, games, status, flips, pots, bets, breakdown, records } = useLiveCasino(initial);
  const hourly = range === 1;
  const hasPots = Boolean(casino.pots);
  const best = series.length ? [...series].sort((a, b) => b.wagered - a.wagered)[0] : null;
  const worst = series.length ? [...series].sort((a, b) => a.net - b.net)[0] : null;

  return (
    <Stagger className="mx-auto flex max-w-7xl flex-col gap-5" key={casino.slug}>
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
                    {status.connected ? "live" : "offline"} · last event {status.lastEventAt ? <TimeAgo iso={status.lastEventAt} /> : "never"}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{casino.tagline}</p>
              {casino.untracked ? <p className="text-xs text-muted-foreground/70">{casino.untracked}</p> : null}
            </div>
            {s ? (
              <div className="hidden gap-6 text-sm md:flex">
                <Stat label="Players" value={countShort(s.players)} />
                <Stat label="Bets" value={countShort(s.bets)} />
                <Stat label="RTP" value={`${s.rtp.toFixed(1)}%`} />
              </div>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <a href={casino.url} target="_blank" rel="noreferrer">Visit <ExternalLink data-icon="inline-end" className="size-3.5" /></a>
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
            <KpiCard label="Player wins" value={s.playerWins} format={money} hint="Taken home by players on winning bets, net of stake" tone="good" />
            <KpiCard label="Player losses" value={s.playerLosses} format={money} hint="Stakes lost on losing bets" tone="bad" />
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
          <Reveal className="lg:col-span-2">
            {hasPots && breakdown ? <ProfitBreakdownCard data={breakdown} color={casino.color} /> : <GameNetCard games={games} color={casino.color} />}
          </Reveal>
          </div>

          {records ? <Reveal><HighlightsCard data={records} color={casino.color} rangeLabel={RANGE_LABEL[range]} pots={hasPots} meta={casino} /></Reveal> : null}

          <div className="grid gap-4 lg:grid-cols-5">
            <Reveal className="lg:col-span-3">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Top players</CardTitle>
                  <CardDescription>By total wagered in range</CardDescription>
                </CardHeader>
                <CardContent className="px-2"><TopPlayersTable players={players} color={casino.color} site={casino.slug} rangeDays={range === 1 ? undefined : range} /></CardContent>
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
                <CardTitle>{hasPots ? "Recent rounds" : "Recent bets"}</CardTitle>
                <CardDescription>{hasPots ? "Latest settled games in range, newest first" : "Latest settled bets by players, newest first"}</CardDescription>
              </CardHeader>
              <CardContent className="px-2">
                {hasPots ? <RoundsTable flips={flips} pots={pots} color={casino.color} site={casino.slug} /> : <BetsTable bets={bets} color={casino.color} meta={casino} />}
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
