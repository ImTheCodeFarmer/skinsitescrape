"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { AlertTriangle, Bell, Check, ExternalLink, FlaskConical, Pause, Pencil, Play, Plus, Send, Settings2, Trash2, TrendingUp, Trophy, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Reveal, Stagger } from "@/components/reveal";
import { TimeAgo } from "@/components/time-ago";
import { PlayerFinder } from "@/components/player-finder";
import { CASINOS, GAME_LABELS } from "@/lib/casinos";
import { describeRule, KIND_LABELS, type AlertBot, type AlertRule, type RuleKind } from "@/lib/alerts-shared";
import { connectChatAction, createRuleAction, deleteRuleAction, removeBotAction, saveTokenAction, sendTestAction, testRuleAction, toggleRuleAction, updateRuleAction, type ActionState } from "@/app/alerts/actions";
import { cn } from "@/lib/utils";

/** Native select, styled to sit beside <Input>. */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 text-sm transition-[color,border-color,box-shadow] duration-150 ease-out outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover",
        className,
      )}
      {...props}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Outcome of the last action. Colour plus an icon plus the text, so it reads without the fade-in. */
function Outcome({ state }: { state: ActionState }) {
  if (!state || (!state.error && !state.message)) return null;
  const bad = Boolean(state.error);
  return (
    <p role="status" className={cn("flex items-start gap-1.5 text-xs", bad ? "text-rose-400" : "text-emerald-400")}>
      {bad ? <AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.5} /> : <Check className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />}
      {state.error ?? state.message}
    </p>
  );
}

function StepNumber({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums", done ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground")}>
      {done ? <Check className="size-3.5" strokeWidth={2} /> : n}
    </span>
  );
}

// ---------------------------------------------------------------- step 1: token
function TokenStep({ bot }: { bot: AlertBot | null }) {
  const [state, act, pending] = useActionState(saveTokenAction, null);
  const [confirming, setConfirming] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <StepNumber n={1} done={Boolean(bot)} />
        <div className="flex flex-col gap-1">
          <CardTitle>Create a bot with BotFather</CardTitle>
          <CardDescription>Your own bot, in your own Telegram. We only ever send through it, never read from it beyond the first hello.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            <>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">@BotFather</a> in Telegram and send <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">/newbot</code>.</>,
            <>Give it a display name, then a username that ends in <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">bot</code>, for example <span className="font-mono text-xs">my_wager_alerts_bot</span>.</>,
            <>BotFather replies with a token like <span className="font-mono text-xs">123456789:ABC…</span>. Paste it below. Treat it like a password.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3 rounded-lg bg-muted/40 p-3 shadow-border">
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
        {bot ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 shadow-border">
            <span className="flex items-center gap-2 text-sm">
              <Bell className="size-4 text-muted-foreground" strokeWidth={1.5} />
              Bot saved: <a href={`https://t.me/${bot.botUsername}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">@{bot.botUsername}</a>
              <span className="text-xs text-muted-foreground">added <TimeAgo iso={bot.createdAt} /></span>
            </span>
            {confirming ? (
              <span className="flex items-center gap-2 text-xs">
                Remove the bot and its connection?
                <Button size="xs" variant="destructive" onClick={() => void removeBotAction()}>Remove</Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
              </span>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>Replace or remove</Button>
            )}
          </div>
        ) : null}
        <form action={act} className="flex flex-col gap-3">
          <Field label={bot ? "New token (replaces the saved one)" : "Bot token"} hint="Checked with Telegram before it is stored, then kept encrypted.">
            <div className="flex gap-2">
              <Input name="token" type="password" autoComplete="off" spellCheck={false} placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" required className="font-mono" />
              <Button type="submit" disabled={pending} static className="shrink-0">{pending ? "Checking…" : "Save token"}</Button>
            </div>
          </Field>
          <Outcome state={state} />
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- step 2: chat
function ChatStep({ bot }: { bot: AlertBot | null }) {
  const [state, setState] = React.useState<ActionState>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState>) => start(async () => setState(await fn()));
  const connected = Boolean(bot?.chatId);
  return (
    <Card className={cn(!bot && "opacity-60")}>
      <CardHeader className="flex-row items-start gap-3">
        <StepNumber n={2} done={connected} />
        <div className="flex flex-col gap-1">
          <CardTitle>Connect the chat</CardTitle>
          <CardDescription>Telegram bots cannot message you first. Open your bot, press Start, then let us find that chat.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" disabled={!bot}>
            <a href={bot ? `https://t.me/${bot.botUsername}?start=1` : "#"} target="_blank" rel="noreferrer" aria-disabled={!bot}>
              Open @{bot?.botUsername ?? "your bot"} <ExternalLink data-icon="inline-end" className="size-3.5" strokeWidth={2} />
            </a>
          </Button>
          <Button disabled={!bot || pending} static onClick={() => run(connectChatAction)}>
            {pending ? "Looking…" : connected ? "Reconnect" : "Find my chat"}
          </Button>
          {connected ? (
            <Button variant="ghost" disabled={pending} onClick={() => run(sendTestAction)}>
              Send a test <Send data-icon="inline-end" className="size-3.5" strokeWidth={2} />
            </Button>
          ) : null}
        </div>
        {connected ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">connected</Badge>
            <span>{bot!.chatTitle}</span>
            {bot!.connectedAt ? <span className="text-xs text-muted-foreground">since <TimeAgo iso={bot!.connectedAt} /></span> : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not connected yet. To send alerts to a group instead, add the bot to the group, send a message there, then find the chat.</p>
        )}
        {bot?.lastError ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-400"><AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.5} />Last send failed: {bot.lastError}. If you blocked or deleted the bot, reconnect.</p>
        ) : null}
        <Outcome state={state} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- step 3: rules
/** Add a new alert, or, given `rule`, edit that one in place. */
function RuleForm({ prefill, rule, onDone }: { prefill: { site: string | null; playerId: string | null; playerName: string | null }; rule?: AlertRule; onDone?: () => void }) {
  const [state, act, pending] = useActionState(rule ? updateRuleAction : createRuleAction, null);
  const [kind, setKind] = React.useState<RuleKind>(rule?.kind ?? (prefill.playerId ? "player_bet" : "big_bet"));
  const [site, setSite] = React.useState(rule?.site ?? prefill.site ?? "");
  const [playerId, setPlayerId] = React.useState(rule?.playerId ?? prefill.playerId ?? "");
  const [name, setName] = React.useState(rule?.name ?? (prefill.playerName ? `${prefill.playerName} bets` : ""));
  const [picked, setPicked] = React.useState<string | null>(rule?.playerName ?? prefill.playerName ?? null);
  React.useEffect(() => {
    if (state?.ok && rule) onDone?.();
  }, [state, rule, onDone]);
  const games = Object.entries(GAME_LABELS).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <form action={act} className="flex flex-col gap-4">
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Shown at the top of each message.">
          <Input name="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Whales on Rustypot" />
        </Field>
        <Field label="Watch for" hint={KIND_LABELS[kind].hint}>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as RuleKind)}>
            {(Object.keys(KIND_LABELS) as RuleKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k].label}</option>)}
          </Select>
        </Field>
        <Field label={kind === "player_bet" ? "Site" : "Site (optional)"}>
          <Select name="site" value={site} onChange={(e) => setSite(e.target.value)} required={kind === "player_bet"}>
            <option value="">Any site</option>
            {CASINOS.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Game (optional)">
          <Select name="game" defaultValue={rule?.game ?? ""}>
            <option value="">Any game</option>
            {games.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {kind === "player_bet" ? (
          <Field label="Player" hint={picked ? `Following ${picked}.` : "Search by name, site, favourite game or bet size, or paste an id from a profile URL."}>
            <div className="flex gap-2">
              <Input name="playerId" required value={playerId} onChange={(e) => { setPlayerId(e.target.value); setPicked(null); }} className="font-mono" placeholder="76561198…" />
              <PlayerFinder
                initialSite={site || null}
                onPick={(p) => { setSite(p.site); setPlayerId(p.id); setPicked(p.handle); if (!name.trim()) setName(`${p.handle} bets`); }}
              />
            </div>
          </Field>
        ) : null}
        {kind === "big_win" ? (
          <Field label="Minimum net win" hint="Payout minus stake, in dollars.">
            <Input name="minNetWin" inputMode="decimal" required placeholder="1,000" className="tabular-nums" defaultValue={rule?.minNetWin ?? ""} />
          </Field>
        ) : (
          <Field label={kind === "player_bet" ? "Minimum bet (optional)" : "Minimum bet"} hint="In dollars.">
            <Input name="minWagered" inputMode="decimal" required={kind === "big_bet"} placeholder="500" className="tabular-nums" defaultValue={rule?.minWagered ?? ""} />
          </Field>
        )}
        <Field label="Quiet time (minutes)" hint="After a message, wait this long before this alert can send again. 0 sends every match.">
          <Input name="cooldownMinutes" inputMode="numeric" defaultValue={rule ? String(Math.round(rule.cooldownSeconds / 60)) : "0"} className="tabular-nums" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Outcome state={state} />
        <span className="ml-auto flex items-center gap-2">
          {rule ? <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button> : null}
          <Button type="submit" disabled={pending} static>{pending ? (rule ? "Saving…" : "Adding…") : rule ? "Save changes" : "Add alert"}</Button>
        </span>
      </div>
    </form>
  );
}

const KIND_ICON: Record<RuleKind, React.ComponentType<React.SVGProps<SVGSVGElement> & { strokeWidth?: number }>> = { big_bet: TrendingUp, player_bet: UserRound, big_win: Trophy };
const KIND_TONE: Record<RuleKind, string> = { big_bet: "bg-sky-500/15 text-sky-400", player_bet: "bg-violet-500/15 text-violet-400", big_win: "bg-amber-500/15 text-amber-400" };

function RuleCard({ r, onEdit, editing }: { r: AlertRule; onEdit: () => void; editing: boolean }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const [test, setTest] = React.useState<ActionState>(null);
  const Icon = KIND_ICON[r.kind];
  return (
    <li className={cn("flex flex-col gap-3 rounded-xl bg-card p-4 shadow-border transition-[box-shadow] duration-150 ease-out hover:shadow-border-hover", !r.enabled && "opacity-70", editing && "ring-2 ring-foreground/25")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", r.enabled ? KIND_TONE[r.kind] : "bg-muted text-muted-foreground")}>
          <Icon className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-medium">{r.name}</h3>
            <span className={cn("inline-flex items-center gap-1.5 text-[11px]", r.enabled ? "text-emerald-400" : "text-muted-foreground")}>
              <span className={cn("size-1.5 rounded-full", r.enabled ? "bg-emerald-400" : "bg-muted-foreground")} aria-hidden />
              {r.enabled ? "Active" : "Paused"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{describeRule(r)}</p>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label={r.enabled ? `Pause ${r.name}` : `Resume ${r.name}`} title={r.enabled ? "Pause" : "Resume"} disabled={pending} onClick={() => start(() => toggleRuleAction(r.id, !r.enabled))}>
          {r.enabled ? <Pause className="size-3.5" strokeWidth={1.5} /> : <Play className="size-3.5" strokeWidth={1.5} />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          <Badge variant="outline" className="mr-2 px-1.5 py-0 text-[10px] font-normal">{KIND_LABELS[r.kind].label}</Badge>
          {r.firedCount ? <>Sent {r.firedCount.toLocaleString("en-US")}×{r.lastFiredAt ? <>, last <TimeAgo iso={r.lastFiredAt} /></> : null}</> : "Not sent yet"}
          {r.cooldownSeconds ? <> · quiet {Math.round(r.cooldownSeconds / 60)} min</> : null}
        </span>
        <span className="flex items-center gap-1">
          {confirming ? (
            <>
              <span className="mr-1 text-xs text-muted-foreground">Delete this alert?</span>
              <Button size="xs" variant="destructive" disabled={pending} onClick={() => start(() => deleteRuleAction(r.id))}>Delete</Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="ghost" disabled={pending} title="Send a sample of this alert to your chat" onClick={() => start(async () => setTest(await testRuleAction(r.id)))}>
                <FlaskConical data-icon="inline-start" className="size-3" strokeWidth={1.5} />Test
              </Button>
              <Button size="xs" variant="ghost" disabled={pending} onClick={onEdit} aria-pressed={editing}>
                <Pencil data-icon="inline-start" className="size-3" strokeWidth={1.5} />Edit
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => setConfirming(true)}><Trash2 className="size-3.5" strokeWidth={1.5} /></Button>
            </>
          )}
        </span>
      </div>
      <Outcome state={test} />
    </li>
  );
}

function AlertsTab({ bot, rules, prefill, onSettings }: { bot: AlertBot | null; rules: AlertRule[]; prefill: Prefill; onSettings: () => void }) {
  const ready = Boolean(bot?.chatId);
  const [adding, setAdding] = React.useState(Boolean(prefill.playerId) || rules.length === 0);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const editing = rules.find((r) => r.id === editingId) ?? null;
  const stopEditing = React.useCallback(() => setEditingId(null), []);
  const active = rules.filter((r) => r.enabled).length;
  if (!ready) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted"><Bell className="size-5 text-muted-foreground" strokeWidth={1.5} /></span>
          <div>
            <h2 className="text-base font-medium">Connect a bot first</h2>
            <p className="mt-1 text-sm text-muted-foreground">Alerts need somewhere to go. Set up your Telegram bot under Bot settings, then come back here.</p>
          </div>
          <Button onClick={onSettings}>Open bot settings<Settings2 data-icon="inline-end" className="size-4" strokeWidth={2} /></Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rules.length === 0 ? "No alerts yet." : <>{rules.length} {rules.length === 1 ? "alert" : "alerts"}, {active} active.</>} Delivered to <span className="text-foreground">{bot!.chatTitle}</span> via @{bot!.botUsername}.
        </p>
        <Button variant={adding ? "outline" : "default"} onClick={() => { setAdding((v) => !v); setEditingId(null); }} aria-expanded={adding}>
          {adding ? <><X data-icon="inline-start" className="size-4" strokeWidth={2} />Close</> : <><Plus data-icon="inline-start" className="size-4" strokeWidth={2} />New alert</>}
        </Button>
      </div>
      {editing ? (
        <Card className="gap-0 p-0 ring-2 ring-foreground/25">
          <CardHeader className="pt-4 pb-3">
            <CardTitle>Edit alert</CardTitle>
            <CardDescription>Changing the condition applies to the next matching bet; the send count is kept.</CardDescription>
          </CardHeader>
          <CardContent className="pb-4"><RuleForm key={editing.id} prefill={prefill} rule={editing} onDone={stopEditing} /></CardContent>
        </Card>
      ) : null}
      {adding && !editing ? (
        <Card className="gap-0 p-0">
          <CardHeader className="pt-4 pb-3">
            <CardTitle>New alert</CardTitle>
            <CardDescription>One condition on a settled bet. Every match arrives as its own message.</CardDescription>
          </CardHeader>
          <CardContent className="pb-4"><RuleForm prefill={prefill} /></CardContent>
        </Card>
      ) : null}
      {rules.length ? (
        <ul className="grid gap-3 md:grid-cols-2">{rules.map((r) => <RuleCard key={r.id} r={r} editing={r.id === editingId} onEdit={() => { setEditingId(r.id === editingId ? null : r.id); setAdding(false); }} />)}</ul>
      ) : !adding ? (
        <p className="text-sm text-muted-foreground">Add your first alert with the button above.</p>
      ) : null}
    </div>
  );
}

type Prefill = { site: string | null; playerId: string | null; playerName: string | null };

export function AlertsView({ bot, rules, prefill }: { bot: AlertBot | null; rules: AlertRule[]; prefill: Prefill }) {
  const ready = Boolean(bot?.chatId);
  const [tab, setTab] = React.useState(ready ? "alerts" : "settings");
  return (
    <Stagger className="mx-auto flex max-w-4xl flex-col gap-5">
      <Reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Telegram alerts</h1>
          <p className="text-sm text-muted-foreground">Your own bot pings you the moment a bet you care about settles.</p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 text-xs", ready ? "text-emerald-400" : "text-muted-foreground")}>
          <span className={cn("size-1.5 rounded-full", ready ? "bg-emerald-400" : "bg-muted-foreground")} aria-hidden />
          {ready ? `Connected as @${bot!.botUsername}` : bot ? "Bot saved, chat not connected" : "No bot yet"}
        </span>
      </Reveal>
      <Reveal>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-8">
            <TabsTrigger value="alerts" className="gap-1.5 text-xs"><Bell className="size-3.5" strokeWidth={2} />Alerts{rules.length ? <span className="text-muted-foreground tabular-nums">{rules.length}</span> : null}</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs"><Settings2 className="size-3.5" strokeWidth={2} />Bot settings</TabsTrigger>
          </TabsList>
          <TabsContent value="alerts"><AlertsTab bot={bot} rules={rules} prefill={prefill} onSettings={() => setTab("settings")} /></TabsContent>
          <TabsContent value="settings" className="flex flex-col gap-4">
            <TokenStep bot={bot} />
            <ChatStep bot={bot} />
          </TabsContent>
        </Tabs>
      </Reveal>
    </Stagger>
  );
}
