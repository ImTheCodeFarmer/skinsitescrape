import { Lock } from "lucide-react";
import { SteamSignInLink } from "@/components/steam-button";

/**
 * Shown in place of an admin-only page. Nothing from the page itself is
 * rendered behind it: the caller must return this before touching any data.
 */
export function Restricted({ what, signedIn }: { what: string; signedIn: boolean }) {
  return (
    <div className="flex items-start justify-center pt-16 md:pt-32">
      <div className="mx-4 w-full max-w-md rounded-xl bg-card p-6 shadow-border">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
          <Lock className="size-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{what} are restricted</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This part of the site is limited to approved accounts. Reach{" "}
          <a href="https://t.me/steveatit" target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">@steveatit on Telegram</a>{" "}
          for access information.
        </p>
        {!signedIn ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <SteamSignInLink />
            <span className="text-xs text-muted-foreground">Already approved? Sign in and come back.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
