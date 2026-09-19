import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminTabs } from "@/components/admin-tabs";
import { AdminSites } from "@/components/views/admin-sites";
import { TimeAgo } from "@/components/time-ago";
import { ADMIN_TABS, type AdminTab } from "@/lib/admin-tabs";
import { getSession, isAdmin } from "@/lib/auth";
import { siteGames, statuses } from "@/lib/queries";
import { listUsers, type SiteUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — SkinWagerTracker" };

/** Admin-only: connected Steam accounts and per-site info. Anyone else gets the 404 the page would show if it did not exist. */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  if (!isAdmin(session)) notFound();
  const sp = await searchParams;
  const tab: AdminTab = ADMIN_TABS.find(([v]) => v === sp.tab)?.[0] ?? "users";
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session!.name}.</p>
        </div>
        <AdminTabs current={tab} />
      </div>
      {tab === "sites" ? <Sites /> : <Users users={await listUsers()} />}
    </div>
  );
}

async function Sites() {
  const [s, g] = await Promise.all([statuses(), siteGames()]);
  return <AdminSites statuses={s} games={g} />;
}

function Users({ users }: { users: SiteUser[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Steam accounts</CardTitle>
        <CardDescription>
          {users.length} {users.length === 1 ? "account has" : "accounts have"} signed in. Most recent first.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {users.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">Nobody has signed in yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Steam id</TableHead>
                <TableHead>First sign-in</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Sign-ins</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.steamId}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-7">
                        {u.avatar ? <AvatarImage src={u.avatar} alt="" /> : null}
                        <AvatarFallback className="text-[10px]">{(u.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{u.name ?? "Unknown"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <a href={`https://steamcommunity.com/profiles/${u.steamId}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted-foreground hover:text-foreground">
                      {u.steamId}
                    </a>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground"><TimeAgo iso={u.firstLogin} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground"><TimeAgo iso={u.lastLogin} /></TableCell>
                  <TableCell className="text-right tabular-nums">{u.logins}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
