"use client";

import * as React from "react";
import { useTransition } from "react";
import { AlertTriangle, ExternalLink, ShieldAlert, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SteamIcon } from "@/components/steam-button";
import { TimeAgo } from "@/components/time-ago";
import { PlayerAvatar } from "@/components/player-link";
import { fetchSteamAction } from "@/app/player/actions";
import type { SteamProfile } from "@/lib/types";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** The Steam tab: the fetched profile, or a button to fetch it when we hold a Steam id but no data yet. */
export function SteamPanel({ site, id, steamId, steam }: { site: string; id: string; steamId: string | null; steam: SteamProfile | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  if (!steam) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted"><SteamIcon className="size-5 text-muted-foreground" /></span>
          {steamId ? (
            <>
              <div>
                <h2 className="text-base font-medium">No Steam data yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  We know this player&apos;s Steam id, <span className="font-mono text-xs">{steamId}</span>. The collector refreshes profiles on a schedule; fetch it now to see the persona, account age, bans, friends and past names.
                </p>
              </div>
              <Button disabled={pending} static onClick={() => start(async () => { setError(null); const r = await fetchSteamAction(site, id, steamId); if (!r?.ok) setError(r?.error ?? "Steam did not answer"); })}>
                <SteamIcon data-icon="inline-start" className="size-4" />{pending ? "Fetching…" : "Fetch Steam data"}
              </Button>
              {error ? <p role="status" className="flex items-start gap-1.5 text-xs text-rose-400"><AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />{error}</p> : null}
            </>
          ) : (
            <div>
              <h2 className="text-base font-medium">No Steam id for this player</h2>
              <p className="mt-1 text-sm text-muted-foreground">None of the counted accounts is keyed by a Steam id, so there is nothing to look up. A link to a Rustypot, RustEasy or Bandit.camp account would provide one.</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4">
        <PlayerAvatar name={steam.persona ?? steam.steamId} avatar={steam.avatar} color="#66c0f4" size={56} />
        <div className="min-w-0 flex-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="truncate">{steam.persona ?? "Unknown persona"}</span>
            <Badge variant="outline" className="font-normal capitalize">{steam.visibility} profile</Badge>
            {steam.vacBanned ? <Badge variant="outline" className="gap-1 border-rose-500/30 font-normal text-rose-400"><ShieldAlert className="size-3" strokeWidth={1.5} />VAC banned</Badge> : null}
          </CardTitle>
          <CardDescription>
            <span className="font-mono text-xs">{steam.steamId}</span> · refreshed <TimeAgo iso={steam.fetchedAt!} /> ·{" "}
            <a href={steam.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground">Open on Steam<ExternalLink className="size-3" strokeWidth={1.5} /></a>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Account created">{steam.accountCreatedAt ? monthYear(steam.accountCreatedAt) : "Hidden"}</Fact>
          <Fact label="Last online">{steam.lastLogoffAt ? <TimeAgo iso={steam.lastLogoffAt} /> : "Hidden"}</Fact>
          <Fact label="Country">{steam.country ?? "Not set"}</Fact>
          <Fact label="Friends">
            <span className="inline-flex items-center gap-1.5 tabular-nums"><UsersRound className="size-3.5 text-muted-foreground" strokeWidth={1.5} />{steam.friendsCount == null ? "Hidden" : steam.friendsCount.toLocaleString("en-US")}</span>
          </Fact>
          <Fact label="VAC ban">{steam.vacBanned == null ? "Unknown" : steam.vacBanned ? "Yes" : "None"}</Fact>
          <Fact label="Game bans">{steam.gameBans == null ? "Unknown" : steam.gameBans === 0 ? "None" : steam.gameBans}</Fact>
        </dl>
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Names used on Steam</h3>
          {steam.aliases.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {steam.aliases.map((a) => (
                <li key={a.name}><Badge variant="secondary" className="gap-1.5 font-normal">{a.name}{a.seenAt ? <span className="text-[10px] text-muted-foreground">{monthYear(a.seenAt)}</span> : null}</Badge></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None recorded. Steam only lists past names on public profiles.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Any of these names matching an account on another site counts as evidence in the linked accounts above.</p>
        </div>
      </CardContent>
    </Card>
  );
}
