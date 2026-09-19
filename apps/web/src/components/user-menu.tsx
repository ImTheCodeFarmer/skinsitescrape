"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SteamIcon, SteamSignInLink } from "@/components/steam-button";

export type SessionView = { steamId: string; name: string; avatar: string | null };

/** Header control: a Steam sign-in link, or the signed-in user's avatar with a sign-out menu. */
export function UserMenu({ session }: { session: SessionView | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const here = `${pathname}${qs ? `?${qs}` : ""}`;

  if (!session) {
    return (
      <SteamSignInLink className="h-8 px-2.5 text-xs">
        <span className="hidden sm:inline">Sign in through Steam</span>
        <span className="sm:hidden">Sign in</span>
      </SteamSignInLink>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-[background-color] duration-150 ease-out hover:bg-muted">
        <Avatar className="size-6">
          {session.avatar ? <AvatarImage src={session.avatar} alt="" /> : null}
          <AvatarFallback className="text-[10px]">{session.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-32 truncate sm:inline">{session.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <SteamIcon className="size-3.5 text-muted-foreground" />
          <span className="truncate font-mono text-xs text-muted-foreground">{session.steamId}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={`/api/auth/logout?next=${encodeURIComponent(here)}`} method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut className="size-4" strokeWidth={1.5} />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
