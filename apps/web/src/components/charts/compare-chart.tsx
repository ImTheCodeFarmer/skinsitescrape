"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CasinoMeta, Point } from "@/lib/types";
import { dayLabel, hourLabel, money, moneyShort } from "@/lib/format";

/** Stacked wager per bucket across tracked sites. */
export function CompareChart({ sites, series, hourly }: { sites: CasinoMeta[]; series: Record<string, Point[]>; hourly: boolean }) {
  const label = hourly ? hourLabel : dayLabel;
  const buckets = new Map<string, Record<string, number | string>>();
  for (const c of sites) {
    for (const p of series[c.slug] ?? []) {
      const row = buckets.get(p.t) ?? { t: p.t };
      row[c.slug] = p.wagered;
      buckets.set(p.t, row);
    }
  }
  const rowsOut = [...buckets.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const config = Object.fromEntries(sites.map((c) => [c.slug, { label: c.name, color: c.color }])) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <AreaChart data={rowsOut} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="t" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(v) => label(String(v))} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => moneyShort(v)} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(l) => label(String(l))}
              formatter={(v, name, item) => (
                <span className="flex w-full items-center gap-2">
                  <span className="size-2 rounded-[2px]" style={{ background: item.color }} />
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                  <span className="ml-auto font-mono font-medium tabular-nums">{money(Number(v))}</span>
                </span>
              )}
            />
          }
        />
        {[...sites].reverse().map((c) => (
          <Area key={c.slug} type="monotone" dataKey={c.slug} stackId="a" stroke={c.color} strokeWidth={1.5} fill={c.color} fillOpacity={0.55} dot={false} animationDuration={900} />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
