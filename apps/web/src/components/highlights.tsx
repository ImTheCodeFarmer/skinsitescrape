"use client";

import Image from "next/image";
import { Clock, Clover, Coins, Crown, Flame, Gem, Landmark, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { gameLabel } from "@/lib/casinos";
import { count, dateTime, money } from "@/lib/format";
import type { Highlight, HighlightPlayer, Highlights } from "@/lib/types";

function Face({ p, color }: { p: HighlightPlayer; color: string }) {
  return p.avatar?.startsWith("http") ? (
    <Image src={p.avatar} alt="" width={24} height={24} unoptimized className="size-6 rounded-full object-cover ring-2 ring-card" />
  ) : (
    <span className="grid size-6 place-items-center rounded-full text-[9px] font-semibold ring-2 ring-card" style={{ background: `${color}22`, color }}>
      {p.house ? "H" : p.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}
    </span>
  );
}

const badgeLabel = (game: string) => (game === "hourly" ? "Hour" : gameLabel(game));

function Tile({ icon, label, h, color, tone }: { icon: React.ReactNode; label: string; h: Highlight | null; color: string; tone: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      {h ? (
        <>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
            {h.format === "count" ? `${count(h.amount)} in a row` : money(h.amount)}
          </div>
          <div className="flex items-center gap-2">
            {h.players.length ? <span className="flex -space-x-1.5">{h.players.map((p, i) => <Face key={i} p={p} color={color} />)}</span> : null}
            <span className="min-w-0 truncate text-sm" title={h.caption}>{h.caption}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{badgeLabel(h.game)}</Badge>
            {dateTime(h.at)}
          </div>
        </>
      ) : (
        <div className="py-3 text-sm text-muted-foreground">Nothing settled in range.</div>
      )}
    </div>
  );
}

type TileSpec = { key: keyof Highlights; label: string; icon: React.ReactNode; tone: string; pots?: boolean };

/** `pots` hides the tiles that only make sense with coinflip / jackpot detail (flip, jackpot, bot, streak, long shot). */
export function HighlightsCard({ data, color, rangeLabel, pots }: { data: Highlights; color: string; rangeLabel: string; pots: boolean }) {
  const all: TileSpec[] = [
    { key: "biggestFlip", label: "Biggest flip", icon: <Coins className="size-3.5" />, tone: "text-amber-400", pots: true },
    { key: "biggestJackpot", label: "Biggest jackpot", icon: <Gem className="size-3.5" />, tone: "text-violet-400", pots: true },
    { key: "biggestPlayerWin", label: "Biggest player win", icon: <Crown className="size-3.5" />, tone: "text-emerald-400" },
    { key: "biggestSiteWin", label: "Biggest site win", icon: <Landmark className="size-3.5" />, tone: "text-rose-400" },
    { key: "biggestBotLoss", label: "Biggest bot loss", icon: <TrendingDown className="size-3.5" />, tone: "text-orange-400", pots: true },
    { key: "longestShot", label: "Longest shot", icon: <Clover className="size-3.5" />, tone: "text-lime-400", pots: true },
    { key: "longestStreak", label: "Longest win streak", icon: <Flame className="size-3.5" />, tone: "text-red-400", pots: true },
    { key: "peakHour", label: "Peak hour", icon: <Clock className="size-3.5" />, tone: "text-sky-400" },
  ];
  const tiles = all.filter((t) => pots || !t.pots);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Records</CardTitle>
        <CardDescription>
          Biggest moments in the {rangeLabel}. {pots ? "Amounts are what the winner received." : "Player win is what they received; site win is the biggest stake a player lost."}
        </CardDescription>
      </CardHeader>
      <CardContent className={pots ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-3 sm:grid-cols-3"}>
        {tiles.map((t) => <Tile key={t.key} icon={t.icon} label={t.label} h={data[t.key]} color={color} tone={t.tone} />)}
      </CardContent>
    </Card>
  );
}
