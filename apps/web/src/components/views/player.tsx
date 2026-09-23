"use client";

import Link from "next/link";
import { Bell, ExternalLink, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BetsTable } from "@/components/bets-table";
import { CasinoLogo } from "@/components/casino-logo";
import { Confidence } from "@/components/confidence";
import { AdminTag, PlayerAvatar, PlayerLink } from "@/components/player-link";
import { NetChart } from "@/components/charts/net-chart";
import { GameShare } from "@/components/charts/game-share";
import { KpiCard } from "@/components/kpi-card";
import { Reveal, Stagger } from "@/components/reveal";
import { TimeAgo } from "@/components/time-ago";
import { SteamIcon } from "@/components/steam-button";
import { SteamPanel } from "@/components/steam-panel";
import { StreamerHeader } from "@/components/streamer-profile";
import { gameLabel, getCasinoMeta } from "@/lib/casinos";
import { count, money, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Account, AccountStats, BetExtreme, PlayerProfile, PlayerTotals, Range } from "@/lib/types";

const RANGE_LABEL: Record<Range, string> = { 1: "last 24 hours", 7: "last 7 days", 30: "last 30 days", 90: "last 90 days" };
const key = (a: Account) => `${a.site}:${a.id}`;

function Avatar({ account, size = 40, className }: { account: Account; size?: number; className?: string }) {
  return <PlayerAvatar name={account.handle} avatar={account.avatar} color={getCasinoMeta(account.site)?.color ?? "#888"} size={size} className={className} />;
}

const signed = (v: number) => `${v < 0 ? "−" : "+"}${money(Math.abs(v))}`;
/** "on Case Battles at Clash.gg, 3 days ago" for an extreme bet; the site is named only on mixed-site lists. */
const extremeHint = (e: BetExtreme, oneSite: boolean) => {
  const site = oneSite ? "" : ` at ${getCasinoMeta(e.site)?.name ?? e.site}`;
  const days = Math.floor((Date.now() - new Date(e.at).getTime()) / 86_400_000);
  const when = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `${money(e.wagered)} on ${gameLabel(e.game)}${site}, ${when}`;
};

function Kpis({ t, range, accent, oneSite }: { t: PlayerTotals; range: Range; accent?: string; oneSite: boolean }) {
  const winRate = t.bets ? t.wins / t.bets : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard label="Wagered" value={t.wagered} format={money} hint={`${count(t.bets)} bets, ${RANGE_LABEL[range]}`} accent={accent} />
      <KpiCard label="Profit / loss" value={t.net} format={signed} hint={t.wagered ? `${pct(t.net / t.wagered)} of wagered · peaked at ${signed(t.high)}, bottomed at ${signed(t.low)}` : "No bets in range"} tone={t.net > 0 ? "good" : t.net < 0 ? "bad" : "neutral"} />
      <KpiCard label="Win rate" value={winRate * 100} format={(v) => `${v.toFixed(1)}%`} hint={`${count(t.wins)} winning bets`} />
      <KpiCard label="Biggest win" value={t.bestWin?.amount ?? 0} format={(v) => `+${money(v)}`} hint={t.bestWin ? extremeHint(t.bestWin, oneSite) : "No winning bet in range"} tone={t.bestWin ? "good" : "neutral"} />
      <KpiCard label="Biggest loss" value={t.worstLoss?.amount ?? 0} format={(v) => `−${money(v)}`} hint={t.worstLoss ? extremeHint(t.worstLoss, oneSite) : "No losing bet in range"} tone={t.worstLoss ? "bad" : "neutral"} />
      <KpiCard label="Active days" value={t.activeDays} format={count} hint={t.favorite ? `Plays ${t.favorite} the most` : "Nothing settled in range"} />
    </div>
  );
}

/** Chart, game mix and recent bets for one account, or for all counted accounts together. */
function Activity({ stats, range, site }: { stats: { series: AccountStats["series"]; games: AccountStats["games"]; recent: AccountStats["recent"] }; range: Range; site?: string }) {
  const meta = site ? getCasinoMeta(site) : undefined;
  const color = meta?.color ?? "#a1a1aa";
  const points = stats.series.map((p) => ({ t: p.t, wagered: p.wagered, net: p.net, players: 1, bets: p.bets }));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Profit and loss</CardTitle>
            <CardDescription>Green {range === 1 ? "hours" : "days"} the player came out ahead, red ones the house did</CardDescription>
          </CardHeader>
          <CardContent>
            {points.length ? <NetChart data={points} hourly={range === 1} /> : <p className="py-10 text-center text-sm text-muted-foreground">No settled bets in this range.</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Games</CardTitle>
            <CardDescription>Share of wager by game</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.games.length ? <GameShare games={stats.games} color={color} /> : <p className="text-sm text-muted-foreground">Nothing settled yet.</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent bets</CardTitle>
          <CardDescription>Newest first{site ? "" : ", across every counted account"}</CardDescription>
        </CardHeader>
        <CardContent className="px-2">
          <BetsTable bets={stats.recent} color={color} meta={meta} showSite={!site} />
        </CardContent>
      </Card>
    </div>
  );
}

export function PlayerView({ range, anchor, linked, countedAt, counted, totals, combined, steamId, steam, streamer }: PlayerProfile) {
  const anchorMeta = getCasinoMeta(anchor.site);
  const countedKeys = new Set(counted.map((c) => key(c.account)));
  const uncounted = linked.filter((l) => !countedKeys.has(key(l)));
  const sites = new Set(counted.map((c) => c.account.site));

  return (
    <Stagger className="mx-auto flex max-w-7xl flex-col gap-5" key={key(anchor)}>
      <Reveal>
        {streamer ? <StreamerHeader anchor={anchor} account={streamer.account} profile={streamer.profile} range={range} /> : (
        <Card className="relative overflow-hidden">
          <span aria-hidden className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full blur-3xl" style={{ background: anchorMeta?.color, opacity: 0.12 }} />
          <CardContent className="flex flex-wrap items-center gap-5 py-2">
            <Avatar account={anchor} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{anchor.handle}</h1>
                {anchorMeta ? (
                  <Link href={`/casino/${anchor.site}?range=${range}`} className="inline-flex">
                    <Badge variant="outline" className="gap-1.5 font-normal"><CasinoLogo casino={anchorMeta} size={14} className="rounded-sm" />{anchorMeta.name}</Badge>
                  </Link>
                ) : null}
                {sites.size > 1 ? <Badge variant="secondary" className="gap-1 font-normal"><Link2 className="size-3" strokeWidth={1.5} />{sites.size} sites</Badge> : null}
                {anchor.admin ? <AdminTag className="h-5 text-xs" /> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {anchor.admin ? <>Marked as an admin of the site: bets are logged below but count toward no total. Right-click the name to change. · </> : null}
                Player id <span className="font-mono text-xs">{anchor.id}</span>
                {anchor.firstSeen ? <> · first seen <TimeAgo iso={anchor.firstSeen} /></> : null}
                {anchor.lastSeen ? <> · last seen <TimeAgo iso={anchor.lastSeen} /></> : null}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/alerts?site=${anchor.site}&player=${encodeURIComponent(anchor.id)}&name=${encodeURIComponent(anchor.handle)}`}>
                <Bell data-icon="inline-start" className="size-3.5" strokeWidth={2} />Alert me
              </Link>
            </Button>
          </CardContent>
        </Card>
        )}
      </Reveal>

      <Kpis t={totals} range={range} accent={anchorMeta?.color} oneSite={sites.size <= 1} />

      <Reveal>
        <Card>
          <CardHeader>
            <CardTitle>Linked accounts</CardTitle>
            <CardDescription>
              {linked.length === 0
                ? "No account on another site looks like this player yet. Links come from Steam ids, Steam profile pictures, display names and when the accounts are active."
                : `Accounts we believe belong to the same person. Those at ${Math.round(countedAt * 100)}% or higher count toward the totals above; weaker matches are listed but kept separate.`}
            </CardDescription>
          </CardHeader>
          {linked.length ? (
            <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {linked.map((l) => {
                const m = getCasinoMeta(l.site);
                const isCounted = l.score >= countedAt;
                return (
                  <div key={key(l)} className={cn("flex flex-col gap-3 rounded-lg px-3 py-2.5 shadow-border", !isCounted && "opacity-80")}>
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <PlayerLink site={l.site} id={l.id} name={l.handle} avatar={l.avatar} admin={l.admin} streamer={l.streamer} color={m?.color ?? "#888"} size={32} className="max-w-full gap-2.5" nameClassName="text-sm font-medium" />
                        <span className="mt-0.5 flex items-center gap-1.5 pl-[42px] text-[11px] text-muted-foreground">
                          {m ? <CasinoLogo casino={m} size={12} className="rounded-sm" /> : null}
                          {m?.name ?? l.site}
                          {l.lastSeen ? <> · seen <TimeAgo iso={l.lastSeen} /></> : null}
                        </span>
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 px-1.5 py-0 text-[10px] font-normal", isCounted ? "border-emerald-500/30 text-emerald-400" : "text-muted-foreground")}>
                        {isCounted ? "counted" : "not counted"}
                      </Badge>
                    </div>
                    <Confidence score={l.score} evidence={l.evidence} hops={l.hops} />
                  </div>
                );
              })}
            </CardContent>
          ) : null}
        </Card>
      </Reveal>

      <Reveal>
        <Tabs defaultValue="all">
          <TabsList className="mb-1 h-8">
            <TabsTrigger value="all" className="text-xs">All sites</TabsTrigger>
            {counted.map((c) => {
              const m = getCasinoMeta(c.account.site);
              return (
                <TabsTrigger key={key(c.account)} value={key(c.account)} className="gap-1.5 text-xs">
                  {m ? <CasinoLogo casino={m} size={14} className="rounded-sm" /> : null}
                  {m?.name ?? c.account.site}
                </TabsTrigger>
              );
            })}
            <TabsTrigger value="steam" className="gap-1.5 text-xs"><SteamIcon className="size-3.5" />Steam{steamId && !steam ? <span className="size-1.5 rounded-full bg-amber-400" aria-label="not fetched yet" /> : null}</TabsTrigger>
          </TabsList>
          <TabsContent value="all"><Activity stats={combined} range={range} /></TabsContent>
          <TabsContent value="steam"><SteamPanel site={anchor.site} id={anchor.id} steamId={steamId} steam={steam} /></TabsContent>
          {counted.map((c) => {
            const m = getCasinoMeta(c.account.site);
            return (
              <TabsContent key={key(c.account)} value={key(c.account)} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-2"><Avatar account={c.account} size={22} /><span className="font-medium text-foreground">{c.account.handle}</span> on {m?.name ?? c.account.site}</span>
                  {m ? <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs hover:text-foreground">{m.url.replace(/^https?:\/\//, "")}<ExternalLink className="size-3" strokeWidth={1.5} /></a> : null}
                </div>
                <Kpis t={c.totals} range={range} accent={m?.color} oneSite />
                <Activity stats={c} range={range} site={c.account.site} />
              </TabsContent>
            );
          })}
        </Tabs>
      </Reveal>

      {uncounted.length ? (
        <p className="px-1 text-xs text-muted-foreground">
          {uncounted.length === 1 ? "One weaker match is" : `${uncounted.length} weaker matches are`} shown above but left out of the totals and tabs.
        </p>
      ) : null}
    </Stagger>
  );
}
