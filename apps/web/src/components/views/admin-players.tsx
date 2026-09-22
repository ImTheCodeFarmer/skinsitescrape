"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CasinoLogo } from "@/components/casino-logo";
import { PlayerLink } from "@/components/player-link";
import { TimeAgo } from "@/components/time-ago";
import { useViewer } from "@/components/viewer";
import { setAdminPlayerAction } from "@/app/player/actions";
import { getCasinoMeta } from "@/lib/casinos";
import type { AdminPlayer } from "@/lib/admin-players";

const count = (v: number) => new Intl.NumberFormat("en-US").format(v);

/** Every admin-marked player, with a button to unmark. Marking happens by right-clicking a name anywhere on the dashboard. */
export function AdminPlayers({ players }: { players: AdminPlayer[] }) {
  const router = useRouter();
  const viewer = useViewer();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const shown = players.filter((p) => viewer.marks.get(`${p.site}:${p.id}`) ?? true);
  const unmark = (p: AdminPlayer) =>
    startTransition(async () => {
      const r = await setAdminPlayerAction(p.site, p.id, false);
      if (r.ok) { viewer.setMark(p.site, p.id, false); router.refresh(); } else setError(r.error);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin players</CardTitle>
        <CardDescription>
          Accounts marked as admins of their site. Their bets are still collected and shown to you with an admin tag, but count toward no total, leaderboard or alert.
          Mark a player by right-clicking their name anywhere on the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {error ? <p className="px-6 pb-3 text-sm text-rose-400">{error}</p> : null}
        {shown.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">No player is marked yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Bets logged</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => {
                const m = getCasinoMeta(p.site);
                return (
                  <TableRow key={`${p.site}:${p.id}`}>
                    <TableCell><PlayerLink site={p.site} id={p.id} name={p.handle} avatar={p.avatar} admin color={m?.color ?? "#888"} size={28} className="gap-2.5" nameClassName="max-w-[14rem] font-medium" /></TableCell>
                    <TableCell className="text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5">{m ? <CasinoLogo casino={m} size={16} className="rounded-sm" /> : null}{m?.name ?? p.site}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{count(p.bets)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.lastSeen ? <TimeAgo iso={p.lastSeen} /> : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => unmark(p)}>
                        <ShieldOff data-icon="inline-start" className="size-3.5" strokeWidth={1.5} />Remove mark
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
