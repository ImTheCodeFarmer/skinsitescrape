"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Point } from "@/lib/types";
import { dayLabel, hourLabel, money, moneyShort } from "@/lib/format";

export function WagerChart({ data, color, id, hourly = false }: { data: Point[]; color: string; id: string; hourly?: boolean }) {
  const label = hourly ? hourLabel : dayLabel;
  const config = { wagered: { label: "Wagered", color } } satisfies ChartConfig;
  const gradId = `wager-fill-${id}`;
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={(v) => label(String(v))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v) => moneyShort(v)}
        />
        <ChartTooltip
          cursor={{ stroke: color, strokeOpacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(l) => label(String(l))}
              formatter={(v) => (
                <span className="ml-auto font-mono font-medium tabular-nums">{money(Number(v))}</span>
              )}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="wagered"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          animationDuration={900}
        />
      </AreaChart>
    </ChartContainer>
  );
}
