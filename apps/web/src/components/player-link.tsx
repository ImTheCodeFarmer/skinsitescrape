import Image from "next/image";
import Link from "next/link";
import { Link2 } from "lucide-react";
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

/**
 * A username as shown anywhere in the app: picture, name and a link icon,
 * the whole thing one link to the player's profile. `children` go between
 * the name and the icon (a streak badge, a "won" tag).
 */
export function PlayerLink({
  site, id, name, avatar, color, size = 22, className, nameClassName, children,
}: {
  site: string; id: string; name: string; avatar: string | null; color: string; size?: number; className?: string; nameClassName?: string; children?: React.ReactNode;
}) {
  return (
    <Link href={profileHref(site, id)} title={`${name}'s profile`} className={cn("group/player inline-flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>
      <PlayerAvatar name={name} avatar={avatar} color={color} size={size} />
      <span className={cn("truncate group-hover/player:underline", nameClassName)}>{name}</span>
      {children}
      <Link2 aria-hidden className="size-3 shrink-0 text-muted-foreground opacity-60 transition-[opacity] duration-150 ease-out group-hover/player:opacity-100" strokeWidth={1.5} />
    </Link>
  );
}
