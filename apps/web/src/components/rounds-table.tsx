"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { TimeAgo } from "@/components/time-ago";
import { cn } from "@/lib/utils";
import type { CoinflipRound, JackpotRound } from "@/lib/types";

const MotionRow = motion.create(TableRow);
const rowAnim = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeOut" as const } },
  transition: { type: "spring" as const, stiffness: 260, damping: 26 },
};

function Who({ name, avatar, house, won, color }: { name: string; avatar: string | null; house?: boolean; won?: boolean; color: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", won && "font-medium")}>
      {avatar?.startsWith("http") ? (
        <Image src={avatar} alt="" width={22} height={22} unoptimized className="size-[22px] shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
      ) : (
        <span className="grid size-[22px] shrink-0 place-items-center rounded-full text-[9px] font-semibold" style={{ background: `${color}22`, color }}>
          {house ? "H" : (name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?")}
        </span>
      )}
      <span className="max-w-[5.5rem] truncate sm:max-w-[9rem]">{name}</span>
      {house ? <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">house</Badge> : null}
      {won ? <span className="text-[10px] text-emerald-400">won</span> : null}
    </span>
  );
}

const Net = ({ v }: { v: number | null }) =>
  v == null ? <span className="text-muted-foreground">—</span> : (
    <span className={cn("font-mono tabular-nums", v >= 0 ? "text-emerald-400" : "text-rose-400")}>{v >= 0 ? "+" : "−"}{money(Math.abs(v))}</span>
  );

const Empty = ({ what }: { what: string }) => <p className="px-4 py-8 text-center text-sm text-muted-foreground">No {what} settled in this range yet.</p>;

export function RoundsTable({ flips, pots, color }: { flips: CoinflipRound[]; pots: JackpotRound[]; color: string }) {
  const tabs = [flips.length || !pots.length ? "flips" : null, pots.length || !flips.length ? "jackpots" : null].filter(Boolean) as string[];
  return (
    <Tabs defaultValue={tabs[0] ?? "flips"} className="px-2">
      <TabsList className="mb-2 h-8">
        <TabsTrigger value="flips" className="text-xs">Flips <span className="ml-1 text-muted-foreground">{flips.length}</span></TabsTrigger>
        <TabsTrigger value="jackpots" className="text-xs">Jackpots <span className="ml-1 text-muted-foreground">{pots.length}</span></TabsTrigger>
      </TabsList>

      <TabsContent value="flips">
        {!flips.length ? <Empty what="flips" /> : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Settled</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Opponent</TableHead>
                <TableHead className="text-right">Pot</TableHead>
                <TableHead className="hidden text-right md:table-cell">Tax</TableHead>
                <TableHead className="text-right">House net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false}>
              {flips.map((f) => (
                <MotionRow key={f.id} layout {...rowAnim}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground"><TimeAgo iso={f.settledAt ?? f.createdAt} /></TableCell>
                  <TableCell><Who name={f.creator.name} avatar={f.creator.avatar} house={f.creator.house} won={f.winnerId === f.creator.id} color={color} /></TableCell>
                  <TableCell>{f.opponent ? <Who name={f.opponent.name} avatar={f.opponent.avatar} house={f.opponent.house} won={f.winnerId === f.opponent.id} color={color} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(f.pot)}</TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">{f.tax == null ? "—" : money(f.tax)}</TableCell>
                  <TableCell className="text-right"><Net v={f.houseNet} /></TableCell>
                </MotionRow>
              ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="jackpots">
        {!pots.length ? <Empty what="jackpots" /> : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Settled</TableHead>
                <TableHead>Winner</TableHead>
                <TableHead className="hidden text-right md:table-cell">Chance</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">Pot</TableHead>
                <TableHead className="text-right">House net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false}>
              {pots.map((j) => (
                <MotionRow key={j.id} layout {...rowAnim}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    <TimeAgo iso={j.settledAt ?? j.createdAt} />
                    {j.partial ? <Badge variant="outline" className="ml-2 px-1 py-0 text-[9px]">partial</Badge> : null}
                  </TableCell>
                  <TableCell>{j.winner ? <Who name={j.winner.name} avatar={j.winner.avatar} color={color} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{j.winnerChance == null ? "—" : `${j.winnerChance.toFixed(1)}%`}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.entries || "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{money(j.pot)}</TableCell>
                  <TableCell className="text-right"><Net v={j.houseNet} /></TableCell>
                </MotionRow>
              ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        )}
      </TabsContent>
    </Tabs>
  );
}
