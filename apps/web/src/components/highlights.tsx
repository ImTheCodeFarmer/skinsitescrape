"use client";

import Image from "next/image";
import { Coins, Crown, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime, money } from "@/lib/format";
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

function Tile({ icon, label, h, color, tone }: { icon: React.ReactNode; label: string; h: Highlight | null; color: string; tone: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      {h ? (
        <>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{money(h.amount)}</div>
          <div className="flex items-center gap-2">
            <span className="flex -space-x-1.5">{h.players.map((p, i) => <Face key={i} p={p} color={color} />)}</span>
            <span className="min-w-0 truncate text-sm">{h.caption}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal capitalize">{h.game}</Badge>
            {dateTime(h.at)}
          </div>
        </>
      ) : (
        <div className="py-3 text-sm text-muted-foreground">Nothing settled in range.</div>
      )}
    </div>
  );
}

export function HighlightsCard({ data, color, rangeLabel }: { data: Highlights; color: string; rangeLabel: string }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Records</CardTitle>
        <CardDescription>Biggest moments in the {rangeLabel}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <Tile icon={<Coins className="size-3.5" />} label="Biggest flip" h={data.biggestFlip} color={color} tone="text-amber-400" />
        <Tile icon={<Crown className="size-3.5" />} label="Biggest player win" h={data.biggestPlayerWin} color={color} tone="text-emerald-400" />
        <Tile icon={<Landmark className="size-3.5" />} label="Biggest site win" h={data.biggestSiteWin} color={color} tone="text-rose-400" />
      </CardContent>
    </Card>
  );
}
