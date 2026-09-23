"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ExternalLink, Pencil, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CasinoLogo } from "@/components/casino-logo";
import { AdminTag, PlayerAvatar, StreamerTag, profileHref } from "@/components/player-link";
import { TimeAgo } from "@/components/time-ago";
import { useViewer } from "@/components/viewer";
import { saveStreamerProfileAction } from "@/app/player/actions";
import { getCasinoMeta } from "@/lib/casinos";
import { STREAMER_PLATFORMS, streamerLinkLabel, type StreamerProfile } from "@/lib/streamer-links";
import type { Account, Range } from "@/lib/types";

const STREAMER_COLOR = "#8b5cf6";

/** The streamer's channels and socials as buttons, in platform order, each tinted with its platform's colour. */
export function StreamerLinks({ profile, className }: { profile: StreamerProfile; className?: string }) {
  const links = STREAMER_PLATFORMS.flatMap((p) => (profile.links[p.key] ? [{ ...p, url: profile.links[p.key]! }] : []));
  if (!links.length) return null;
  return (
    <div className={className ?? "flex flex-wrap gap-2"}>
      {links.map((l) => (
        <a
          key={l.key}
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          title={`${l.label}: ${l.url}`}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium shadow-border transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.96]"
        >
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: l.color }} />
          <span>{l.label}</span>
          <span className="truncate font-normal text-muted-foreground">{streamerLinkLabel(l.key, l.url)}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        </a>
      ))}
    </div>
  );
}

/**
 * The top of a streamer's profile: the name they stream under, their bio
 * and channel links above the account they play on. `anchor` is the account
 * the page is for; `account` the streamer-marked one, which differs when the
 * page is for one of the streamer's other accounts.
 */
export function StreamerHeader({ anchor, account, profile, range }: { anchor: Account; account: Account; profile: StreamerProfile; range: Range }) {
  const viewer = useViewer();
  const [editing, setEditing] = React.useState(false);
  const meta = getCasinoMeta(anchor.site);
  const viaAlt = anchor.site !== account.site || anchor.id !== account.id;
  const title = profile.name ?? account.handle;
  const hasLinks = Object.keys(profile.links).length > 0;

  return (
    <Card className="relative overflow-hidden">
      <span aria-hidden className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full blur-3xl" style={{ background: STREAMER_COLOR, opacity: 0.16 }} />
      <span aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-72 rounded-full blur-3xl" style={{ background: meta?.color, opacity: 0.08 }} />
      <CardContent className="flex flex-col gap-4 py-2">
        <div className="flex flex-wrap items-center gap-5">
          <PlayerAvatar name={anchor.handle} avatar={anchor.avatar} color={meta?.color ?? "#888"} size={72} className="ring-2 ring-violet-500/40 ring-offset-2 ring-offset-card" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
              <StreamerTag className="h-5 text-xs" />
              {anchor.admin ? <AdminTag className="h-5 text-xs" /> : null}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              Plays as <span className="font-medium text-foreground">{anchor.handle}</span> on
              {meta ? (
                <Link href={`/casino/${anchor.site}?range=${range}`} className="inline-flex">
                  <Badge variant="outline" className="gap-1.5 font-normal"><CasinoLogo casino={meta} size={14} className="rounded-sm" />{meta.name}</Badge>
                </Link>
              ) : anchor.site}
              {viaAlt ? <>· linked to the streamer account <Link href={profileHref(account.site, account.id)} className="text-foreground underline-offset-2 hover:underline">{account.handle}</Link> on {getCasinoMeta(account.site)?.name ?? account.site}</> : null}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Player id <span className="font-mono">{anchor.id}</span>
              {anchor.firstSeen ? <> · first seen <TimeAgo iso={anchor.firstSeen} /></> : null}
              {anchor.lastSeen ? <> · last seen <TimeAgo iso={anchor.lastSeen} /></> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {viewer.admin ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil data-icon="inline-start" className="size-3.5" strokeWidth={2} />Edit streamer
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/alerts?site=${anchor.site}&player=${encodeURIComponent(anchor.id)}&name=${encodeURIComponent(anchor.handle)}`}>
                <Bell data-icon="inline-start" className="size-3.5" strokeWidth={2} />Alert me
              </Link>
            </Button>
          </div>
        </div>
        {profile.bio ? <p className="max-w-3xl text-sm text-pretty whitespace-pre-line">{profile.bio}</p> : null}
        {hasLinks ? (
          <StreamerLinks profile={profile} />
        ) : viewer.admin ? (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground shadow-border transition-colors hover:text-foreground">
            <Radio className="size-3.5" strokeWidth={1.5} />No channels yet. Add their Twitch, Kick, X and more.
          </button>
        ) : null}
      </CardContent>
      {viewer.admin ? <StreamerEditor open={editing} onOpenChange={setEditing} account={account} profile={profile} /> : null}
    </Card>
  );
}

/** Side sheet where a dashboard admin edits the streamer's name, bio and links. Handles and full URLs are both accepted. */
function StreamerEditor({ open, onOpenChange, account, profile }: { open: boolean; onOpenChange: (open: boolean) => void; account: Account; profile: StreamerProfile }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      name: String(f.get("name") ?? ""),
      bio: String(f.get("bio") ?? ""),
      links: Object.fromEntries(STREAMER_PLATFORMS.map((p) => [p.key, String(f.get(`link:${p.key}`) ?? "")])),
    };
    startTransition(async () => {
      const r = await saveStreamerProfileAction(account.site, account.id, input);
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) setError(null); onOpenChange(v); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Streamer profile</SheetTitle>
          <SheetDescription>
            For {account.handle} on {getCasinoMeta(account.site)?.name ?? account.site}. Type a handle (<span className="font-mono text-xs">@name</span>) or paste a full link; leave a field empty to hide it.
          </SheetDescription>
        </SheetHeader>
        <form key={profile.updatedAt ?? "new"} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Streams as</span>
              <Input name="name" defaultValue={profile.name ?? ""} placeholder={account.handle} maxLength={80} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Bio</span>
              <textarea
                name="bio"
                defaultValue={profile.bio ?? ""}
                maxLength={500}
                rows={3}
                placeholder="Who they are, what they play, sponsorships…"
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              />
            </label>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-medium text-muted-foreground">Channels and socials</span>
              {STREAMER_PLATFORMS.map((p) => (
                <label key={p.key} className="grid grid-cols-[7rem_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 text-sm"><span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />{p.label}</span>
                  <Input name={`link:${p.key}`} defaultValue={profile.links[p.key] ?? ""} placeholder={p.key === "website" ? "example.com" : p.key === "discord" ? "invite code or link" : "@handle"} />
                </label>
              ))}
            </div>
          </div>
          <SheetFooter className="border-t">
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
