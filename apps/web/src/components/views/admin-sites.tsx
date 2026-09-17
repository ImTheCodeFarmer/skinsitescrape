import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CasinoLogo } from "@/components/casino-logo";
import { CASINOS } from "@/lib/casinos";
import type { CasinoMeta, SiteGameInfo, SiteStatus } from "@/lib/types";

const rate = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
const count = (v: number) => new Intl.NumberFormat("en-US").format(v);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC" : "never");

function Collector({ status }: { status: SiteStatus | null }) {
  if (!status) return <Badge variant="outline" className="text-muted-foreground">No collector</Badge>;
  return status.connected ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">Connected</Badge> : <Badge variant="outline" className="border-rose-500/30 text-rose-400">Disconnected</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function SiteCard({ meta, status, games }: { meta: CasinoMeta; status: SiteStatus | null; games: SiteGameInfo[] }) {
  const c = meta.conversion;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CasinoLogo casino={meta} size={36} />
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2">
              {meta.name}
              <span className="font-mono text-xs font-normal text-muted-foreground">{meta.slug}</span>
            </CardTitle>
            <CardDescription>{meta.tagline}</CardDescription>
          </div>
          <Collector status={status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Conversion">
            <span className="font-medium tabular-nums">1 {c.unit} = {rate(c.usdPerUnit)}</span>
            {c.live ? <Badge variant="outline" className="ml-2 text-[10px]">live</Badge> : null}
            {c.assumed ? <Badge variant="outline" className="ml-2 border-amber-500/30 text-[10px] text-amber-400">assumed</Badge> : null}
          </Field>
          <Field label="On the feed">{c.wire}</Field>
          <Field label="Website">
            <a href={meta.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">{meta.url.replace(/^https?:\/\//, "")}</a>
          </Field>
          <Field label="Founded">{meta.founded}</Field>
          <Field label="Last event">{when(status?.lastEventAt ?? null)}</Field>
          <Field label="Last connect">{when(status?.lastConnectAt ?? null)}</Field>
          <Field label="Reconnects">{status ? count(status.reconnects) : "—"}</Field>
          <Field label="Pot tables">{meta.pots ? "Coinflip and jackpot detail" : "No"}</Field>
        </dl>
        <p className="text-xs text-muted-foreground">
          <span className="text-foreground/80">Rate source:</span> {c.source}
          {c.live ? " The collector follows the feed's rate; the figure here is its fallback." : ""}
        </p>
        {meta.untracked ? (
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground/80">Not tracked:</span> {meta.untracked}
          </p>
        ) : null}
        {games.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Game</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Bets</TableHead>
                <TableHead>First day</TableHead>
                <TableHead>Last day</TableHead>
                <TableHead>Round page</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map((g) => (
                <TableRow key={g.game}>
                  <TableCell className="font-medium">{g.label}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{g.game}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(g.bets)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{day(g.firstDay)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{day(g.lastDay)}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">{meta.roundUrls?.[g.game] ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No bets stored for this site yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Admin-only: what we know about each site, how its money is converted to USD, and what is stored for it. */
export function AdminSites({ statuses, games }: { statuses: Record<string, SiteStatus>; games: Record<string, SiteGameInfo[]> }) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Conversion rates</CardTitle>
          <CardDescription>Every stored amount is USD. This is what one unit of each site&apos;s balance is counted as.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">USD per unit</TableHead>
                <TableHead>On the feed</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Collector</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CASINOS.map((m) => (
                <TableRow key={m.slug}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <CasinoLogo casino={m} size={24} />
                      <span className="font-medium">{m.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{m.conversion.unit}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{rate(m.conversion.usdPerUnit)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.conversion.wire}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.conversion.assumed ? "Assumed" : m.conversion.live ? "From the site's feed" : "Fixed"}</TableCell>
                  <TableCell><Collector status={statuses[m.slug] ?? null} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {CASINOS.map((m) => (
        <SiteCard key={m.slug} meta={m} status={statuses[m.slug] ?? null} games={games[m.slug] ?? []} />
      ))}
    </div>
  );
}
