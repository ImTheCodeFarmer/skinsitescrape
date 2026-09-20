"use client";

import { Check, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal, Stagger } from "@/components/reveal";
import { cn } from "@/lib/utils";

const TELEGRAM = "https://t.me/steveatit";

type Plan = {
  id: string;
  name: string;
  monthly: number;
  months: number;
  blurb: string;
  featured?: boolean;
};

const PLANS: Plan[] = [
  { id: "6", name: "6 months", monthly: 500, months: 6, blurb: "Billed every six months." },
  { id: "12", name: "12 months", monthly: 400, months: 12, blurb: "Billed once a year.", featured: true },
];

/** What every plan includes. The first four are the headline items; the rest round out the offer. */
const FEATURES: { title: string; detail: string }[] = [
  { title: "Player profiles", detail: "Every player's wagers, profit and loss, game mix and recent bets on one page." },
  { title: "Cross-site tracking", detail: "Accounts linked across casinos by Steam id, avatar, name and activity, each with a confidence score." },
  { title: "Custom Telegram bot for alerts", detail: "Your own bot pinging you on big bets, streaks, site outages or anything you define." },
  { title: "Custom feature requests", detail: "Ask for a view, a metric or a site and we build it into your account." },
  { title: "Every tracked casino, live", detail: "Rustypot, Clash, RustClash, Cases, RustEasy, CSGOGem, Bandit.camp, RustMagic, Rustyloot, CSGORoll, Splits, RustBattle and the next ones." },
  { title: "Full history", detail: "30 and 90 day ranges on every site, plus records, leaderboards and daily house profit." },
  { title: "Data export", detail: "Pull bets, rounds and player stats as CSV for your own analysis." },
  { title: "Priority support", detail: "A direct line on Telegram, and early access to new sites as they come online." },
];

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function PlanCard({ plan, saving }: { plan: Plan; saving: number }) {
  const total = plan.monthly * plan.months;
  return (
    <Card className={cn("relative h-full gap-0 overflow-visible p-6", plan.featured && "ring-2 ring-foreground/25 shadow-border")}>
      {plan.featured ? (
        <Badge className="absolute -top-2.5 left-6 px-2.5">Best value · save {saving}%</Badge>
      ) : null}
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{plan.name}</h2>
        <p className="text-sm text-muted-foreground">{plan.blurb}</p>
      </div>
      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">{money(plan.monthly)}</span>
        <span className="text-sm text-muted-foreground">per month</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {money(total)} billed every {plan.months} months
      </p>
      <Button asChild size="lg" variant={plan.featured ? "default" : "outline"} className="mt-6 w-full">
        <a href={TELEGRAM} target="_blank" rel="noreferrer">
          Get started on Telegram
          <Send data-icon="inline-end" className="size-4" strokeWidth={plan.featured ? 2 : 1.5} />
        </a>
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">Message @steveatit and your Steam account is approved within the day.</p>
    </Card>
  );
}

export function PricingView() {
  const base = PLANS[0].monthly;
  const best = Math.min(...PLANS.map((p) => p.monthly));
  const saving = Math.round((1 - best / base) * 100);

  return (
    <Stagger className="mx-auto flex max-w-5xl flex-col gap-10 py-6">
      <Reveal className="flex flex-col items-center gap-3 text-center">
        <Badge variant="outline" className="font-normal">Full access</Badge>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">One plan, two ways to pay</h1>
        <p className="max-w-xl text-pretty text-muted-foreground">
          Everything SkinWagerTracker collects across every casino it watches, plus the tools that only paying members get. Pay six months at a time, or a year at a time and save {saving}%.
        </p>
      </Reveal>

      <div className="grid gap-4 pt-3 md:grid-cols-2">
        {PLANS.map((p) => (
          <Reveal key={p.id}>
            <PlanCard plan={p} saving={saving} />
          </Reveal>
        ))}
      </div>

      <Reveal>
        <Card className="gap-0 p-6">
          <h2 className="text-base font-medium">Included in both plans</h2>
          <p className="mt-1 text-sm text-muted-foreground">The same access either way. The only difference is how often you pay.</p>
          <ul className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <Check className="size-3" strokeWidth={2} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{f.title}</span>
                  <span className="text-sm text-muted-foreground">{f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Reveal>

      <Reveal>
        <dl className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <dt className="text-sm font-medium">How do I get access?</dt>
            <dd className="text-sm text-muted-foreground">Message @steveatit on Telegram with the plan you want. Once paid, sign in here with Steam and your account is unlocked.</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-sm font-medium">Can I switch plans?</dt>
            <dd className="text-sm text-muted-foreground">Yes. Move from six months to a year at your next renewal and the lower rate applies from then on.</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-sm font-medium">What if a site goes dark?</dt>
            <dd className="text-sm text-muted-foreground">Collectors are watched around the clock and reconnect on their own. If a casino changes its feed, fixing it is part of the plan.</dd>
          </div>
        </dl>
      </Reveal>
    </Stagger>
  );
}
