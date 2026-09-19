"use client";

import { motion } from "motion/react";
import type { GameStat } from "@/lib/types";
import { moneyShort, countShort } from "@/lib/format";

/** Horizontal bars, one hue: share of wager by game. */
export function GameShare({ games, color }: { games: GameStat[]; color: string }) {
  const total = games.reduce((a, g) => a + g.wagered, 0);
  const max = Math.max(...games.map((g) => g.wagered));
  return (
    <ul className="flex flex-col gap-3">
      {games.map((g, i) => {
        const share = g.wagered / total;
        return (
          <li key={g.name} className="group">
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">{g.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {moneyShort(g.wagered)} · {(share * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full"
                style={{ background: color }}
                initial={{ width: 0 }}
                animate={{ width: `${(g.wagered / max) * 100}%` }}
                transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 90, damping: 20 }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground opacity-0 transition-[opacity] duration-150 ease-out group-hover:opacity-100">
              <span>{countShort(g.plays)} plays</span>
              <span>{g.wagered ? ((g.net / g.wagered) * 100).toFixed(1) : "0.0"}% edge</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
