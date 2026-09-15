import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NumberTicker } from "@/components/number-ticker";
import { Reveal } from "@/components/reveal";
import { cn } from "@/lib/utils";
import { pct } from "@/lib/format";

export function KpiCard({
  label,
  value,
  format,
  delta,
  hint,
  tone = "neutral",
  accent,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  delta?: number;
  hint?: string;
  tone?: "neutral" | "good" | "bad";
  accent?: string;
}) {
  const up = delta !== undefined && delta > 0.005;
  const down = delta !== undefined && delta < -0.005;
  return (
    <Reveal className="h-full">
      <Card className="relative h-full gap-1 overflow-hidden px-5 py-4 transition-colors hover:bg-card/80">
        {accent ? (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px opacity-70"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
          />
        ) : null}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {delta !== undefined ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums",
                up && "bg-emerald-500/10 text-emerald-400",
                down && "bg-rose-500/10 text-rose-400",
                !up && !down && "bg-muted text-muted-foreground",
              )}
            >
              {up ? <ArrowUpRight className="size-3" /> : down ? <ArrowDownRight className="size-3" /> : <Minus className="size-3" />}
              {pct(delta)}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "text-2xl font-semibold tracking-tight",
            tone === "good" && "text-emerald-400",
            tone === "bad" && "text-rose-400",
          )}
        >
          <NumberTicker value={value} format={format} />
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </Card>
    </Reveal>
  );
}
