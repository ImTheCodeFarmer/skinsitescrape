"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CasinoLogo } from "@/components/casino-logo";
import { PlayerLink } from "@/components/player-link";
import { StreamerLinks } from "@/components/streamer-profile";
import { TimeAgo } from "@/components/time-ago";
import { useViewer } from "@/components/viewer";
import { setStreamerAction } from "@/app/player/actions";
import { getCasinoMeta } from "@/lib/casinos";
import type { StreamerRow } from "@/lib/streamers";

/** Every streamer-marked player with their channels, and a button to unmark. Marking happens by right-clicking a name anywhere on the dashboard. */
export function AdminStreamers({ streamers }: { streamers: StreamerRow[] }) {
  const router = useRouter();
  const viewer = useViewer();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const shown = streamers.filter((p) => viewer.marks.get(`${p.site}:${p.id}`)?.streamer ?? true);
  const unmark = (p: StreamerRow) =>
    startTransition(async () => {
      const r = await setStreamerAction(p.site, p.id, false);
      if (r.ok) { viewer.setMark(p.site, p.id, { streamer: false }); router.refresh(); } else setError(r.error);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Streamers</CardTitle>
        <CardDescription>
          Accounts marked as streamers. Their bets count like anyone&apos;s; the name gets a streamer tag and the profile shows their channels.
          Mark a player by right-clicking their name anywhere on the dashboard, then add their channels from the profile.
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
                <TableHead>Channels</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => {
                const m = getCasinoMeta(p.site);
                return (
                  <TableRow key={`${p.site}:${p.id}`}>
                    <TableCell>
                      <PlayerLink site={p.site} id={p.id} name={p.name ?? p.handle} avatar={p.avatar} streamer color={m?.color ?? "#888"} size={28} className="gap-2.5" nameClassName="max-w-[14rem] font-medium" />
                      {p.name && p.name !== p.handle ? <span className="block pl-[38px] text-[11px] text-muted-foreground">plays as {p.handle}</span> : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5">{m ? <CasinoLogo casino={m} size={16} className="rounded-sm" /> : null}{m?.name ?? p.site}</span></TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      {Object.keys(p.links).length ? <StreamerLinks profile={{ site: p.site, id: p.id, name: p.name, bio: null, links: p.links, updatedAt: null }} className="flex flex-wrap gap-1.5" /> : <span className="text-sm text-muted-foreground">None yet</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.lastSeen ? <TimeAgo iso={p.lastSeen} /> : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => unmark(p)}>
                        <Radio data-icon="inline-start" className="size-3.5" strokeWidth={1.5} />Remove mark
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
