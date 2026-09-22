"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, ShieldCheck, ShieldOff, UserRound } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { adminPlayerStateAction, setAdminPlayerAction } from "@/app/player/actions";
import { useViewer } from "@/components/viewer";
import { cn } from "@/lib/utils";

export const profileHref = (site: string, id: string) => `/player/${site}/${encodeURIComponent(id)}`;

/** A player's picture, or their initials on the site's colour when the site gave none. */
export function PlayerAvatar({ name, avatar, color, size = 22, className, house = false }: { name: string; avatar: string | null; color: string; size?: number; className?: string; house?: boolean }) {
  const initials = house ? "H" : name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return avatar?.startsWith("http") ? (
    <Image src={avatar} alt="" width={size} height={size} unoptimized className={cn("shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10", className)} style={{ width: size, height: size }} />
  ) : (
    <span className={cn("grid shrink-0 place-items-center rounded-full font-semibold", className)} style={{ width: size, height: size, background: `${color}22`, color, fontSize: Math.max(9, Math.round(size * 0.4)) }}>
      {initials}
    </span>
  );
}

/** Tag on an admin-marked player's name: their bets are logged but count toward no total. */
export function AdminTag({ className }: { className?: string }) {
  return (
    <span title="Admin of the site: bets are logged but do not count toward any total" className={cn("inline-flex h-4 shrink-0 items-center gap-1 rounded-4xl border border-amber-500/30 px-1.5 text-[10px] leading-none text-amber-400", className)}>
      <ShieldCheck className="size-2.5" strokeWidth={2} />
      admin
    </span>
  );
}

/**
 * A username as shown anywhere in the app: picture, name and a link icon,
 * the whole thing one link to the player's profile. `children` go between
 * the name and the icon (a streak badge, a "won" tag). `admin` says the
 * player is admin-marked, when the row knows; marks changed in this session
 * override it. Dashboard admins get a right-click menu to change the mark.
 */
export function PlayerLink({
  site, id, name, avatar, color, size = 22, className, nameClassName, admin, children,
}: {
  site: string; id: string; name: string; avatar: string | null; color: string; size?: number; className?: string; nameClassName?: string; admin?: boolean; children?: React.ReactNode;
}) {
  const viewer = useViewer();
  const marked = viewer.marks.get(`${site}:${id}`) ?? admin ?? false;
  const link = (
    <Link href={profileHref(site, id)} title={`${name}'s profile`} className={cn("group/player inline-flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>
      <PlayerAvatar name={name} avatar={avatar} color={color} size={size} />
      <span className={cn("truncate group-hover/player:underline", nameClassName)}>{name}</span>
      {marked ? <AdminTag /> : null}
      {children}
      <Link2 aria-hidden className="size-3 shrink-0 text-muted-foreground opacity-60 transition-[opacity] duration-150 ease-out group-hover/player:opacity-100" strokeWidth={1.5} />
    </Link>
  );
  if (!viewer.admin || !site) return link;
  return <PlayerMenu site={site} id={id} name={name} marked={marked}>{link}</PlayerMenu>;
}

/** Right-click menu for dashboard admins: mark or unmark the player as an admin of their site. */
function PlayerMenu({ site, id, name, marked, children }: { site: string; id: string; name: string; marked: boolean; children: React.ReactNode }) {
  const viewer = useViewer();
  const router = useRouter();
  const [known, setKnown] = React.useState<boolean | null>(viewer.marks.has(`${site}:${id}`) ? marked : null);
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState<{ text: string; error: boolean } | null>(null);
  const current = known ?? marked;

  const onOpenChange = (open: boolean) => {
    if (!open || viewer.marks.has(`${site}:${id}`)) return;
    // The row may not carry the flag; ask before showing which way the toggle goes.
    void adminPlayerStateAction(site, id).then((r) => { if (r.ok) { setKnown(r.admin); viewer.setMark(site, id, r.admin); } });
  };
  const toggle = () => {
    const next = !current;
    startTransition(async () => {
      const r = await setAdminPlayerAction(site, id, next);
      if (r.ok) {
        setKnown(r.admin);
        viewer.setMark(site, id, r.admin);
        setNote({ text: r.message ?? "Saved.", error: false });
        router.refresh();
      } else {
        setNote({ text: r.error, error: true });
      }
      setTimeout(() => setNote(null), 6000);
    });
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel className="max-w-56 truncate">{name}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={pending} onSelect={toggle}>
            {current ? <ShieldOff strokeWidth={1.5} /> : <ShieldCheck strokeWidth={1.5} />}
            {current ? "Remove admin mark" : "Mark as admin"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => router.push(profileHref(site, id))}>
            <UserRound strokeWidth={1.5} />
            Open profile
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {note ? <span className={cn("truncate text-[11px]", note.error ? "text-rose-400" : "text-muted-foreground")}>{note.text}</span> : null}
    </span>
  );
}
