import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSession, isAdmin } from "@/lib/auth";
import { listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — SkinWagerTracker" };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";

/** Admin-only: who has connected a Steam account. Anyone else gets the 404 the page would show if it did not exist. */
export default async function AdminPage() {
  const session = await getSession();
  if (!isAdmin(session)) notFound();
  const users = await listUsers();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">Signed in as {session!.name}.</p>
      </div>
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
                    <TableCell className="text-sm text-muted-foreground">{when(u.firstLogin)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{when(u.lastLogin)}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.logins}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
