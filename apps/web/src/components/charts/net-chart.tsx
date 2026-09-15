"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Point } from "@/lib/types";
import { dayLabel, hourLabel, money, moneyShort } from "@/lib/format";

const GOOD = "#34d399";
const BAD = "#fb7185";

/** Daily house net. Green days the house profited, red days it paid out more than it took. */
export function NetChart({ data, hourly = false }: { data: Point[]; hourly?: boolean }) {
  const label = hourly ? hourLabel : dayLabel;
  const config = { net: { label: "House net" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="t" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={(v) => label(String(v))} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => moneyShort(v)} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip
          cursor={{ fillOpacity: 0.35 }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(l) => label(String(l))}
              formatter={(v) => {
                const n = Number(v);
                return (
                  <span className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{n >= 0 ? "Profit" : "Loss"}</span>
                    <span className="font-mono font-medium tabular-nums" style={{ color: n >= 0 ? GOOD : BAD }}>
                      {money(Math.abs(n))}
                    </span>
                  </span>
                );
              }}
            />
          }
        />
        <Bar dataKey="net" radius={[3, 3, 0, 0]} animationDuration={900}>
          {data.map((d) => (
            <Cell key={d.t} fill={d.net >= 0 ? GOOD : BAD} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
