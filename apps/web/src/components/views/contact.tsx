"use client";

import * as React from "react";
import { CheckCircle2, Mail, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Reveal, Stagger } from "@/components/reveal";
import { Turnstile, type TurnstileHandle } from "@/components/turnstile";
import { sendContactAction } from "@/app/contact/actions";
import type { ContactField } from "@/lib/contact";
import { cn } from "@/lib/utils";

const TELEGRAM = "https://t.me/steveatit";
const MAX_MESSAGE = 3000;

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <span className="font-normal">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </label>
  );
}

/**
 * Contact form. Messages go to our Telegram through the server action; the
 * Turnstile check, a hidden honeypot field and a per-IP limit keep bots out
 * (lib/contact.ts). Without a site key (local development) the widget is
 * left out and the server skips the check.
 */
export function ContactView({ siteKey, defaultName }: { siteKey: string | null; defaultName: string }) {
  const [pending, startTransition] = React.useTransition();
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState<{ text: string; field?: ContactField } | null>(null);
  const [sent, setSent] = React.useState(false);
  const [length, setLength] = React.useState(0);
  const turnstile = React.useRef<TurnstileHandle>(null);
  const needsToken = Boolean(siteKey);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? "");
    startTransition(async () => {
      const r = await sendContactAction({ name: get("name"), email: get("email"), telegram: get("telegram"), discord: get("discord"), message: get("message"), website: get("website"), token });
      turnstile.current?.reset();
      if (!r.ok) { setError({ text: r.error, field: r.field }); return; }
      setError(null);
      setSent(true);
      form.reset();
      setLength(0);
    });
  };
  const fieldError = (f: ContactField) => (error?.field === f ? error.text : null);

  return (
    <Stagger className="mx-auto grid max-w-5xl gap-8 py-6 lg:grid-cols-5">
      <Reveal className="flex flex-col gap-4 lg:col-span-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Contact us</h1>
        <p className="text-pretty text-muted-foreground">
          Questions about the data, a site you want tracked, a feature request or a partnership. Leave a way to reach you and we reply within the day.
        </p>
        <div className="flex flex-col gap-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground"><Mail className="size-4" strokeWidth={1.5} />Replies by email, Telegram or Discord</span>
          <a href={TELEGRAM} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
            <Send className="size-4" strokeWidth={1.5} />Or message @steveatit on Telegram
          </a>
        </div>
      </Reveal>

      <Reveal className="lg:col-span-3">
        <Card>
          {sent ? (
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 className="size-10 text-emerald-400" strokeWidth={1.5} />
              <h2 className="text-lg font-medium">Message sent</h2>
              <p className="max-w-sm text-sm text-muted-foreground">Thanks for reaching out. We will get back to you soon.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setSent(false)}>Send another</Button>
            </CardContent>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" strokeWidth={1.5} />Send a message</CardTitle>
                <CardDescription>Name, email and message are required.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" error={fieldError("name")}>
                      <Input name="name" autoComplete="name" defaultValue={defaultName} maxLength={80} required aria-invalid={Boolean(fieldError("name"))} />
                    </Field>
                    <Field label="Email" error={fieldError("email")}>
                      <Input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" aria-invalid={Boolean(fieldError("email"))} />
                    </Field>
                    <Field label="Telegram" hint="optional" error={fieldError("telegram")}>
                      <Input name="telegram" autoComplete="off" maxLength={33} placeholder="@username" aria-invalid={Boolean(fieldError("telegram"))} />
                    </Field>
                    <Field label="Discord" hint="optional" error={fieldError("discord")}>
                      <Input name="discord" autoComplete="off" maxLength={40} placeholder="username" aria-invalid={Boolean(fieldError("discord"))} />
                    </Field>
                  </div>
                  <Field label="Message" hint={`${length.toLocaleString("en-US")} / ${MAX_MESSAGE.toLocaleString("en-US")}`} error={fieldError("message")}>
                    <textarea
                      name="message"
                      required
                      rows={6}
                      maxLength={MAX_MESSAGE}
                      onChange={(e) => setLength(e.target.value.length)}
                      aria-invalid={Boolean(fieldError("message"))}
                      placeholder="How can we help?"
                      className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
                    />
                  </Field>
                  {/* Honeypot: hidden from people and screen readers; bots that fill every field give themselves away. */}
                  <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                    <label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
                  </div>
                  {siteKey ? <Turnstile ref={turnstile} siteKey={siteKey} action="contact" onToken={setToken} /> : null}
                  {error && !error.field ? <p className="text-sm text-rose-400">{error.text}</p> : null}
                  <div className="flex items-center justify-end gap-3">
                    {needsToken && !token ? <span className="text-xs text-muted-foreground">Waiting for the security check…</span> : null}
                    <Button type="submit" disabled={pending || (needsToken && !token)} className={cn(pending && "cursor-wait")}>
                      {pending ? "Sending…" : "Send message"}
                      <Send data-icon="inline-end" className="size-4" strokeWidth={2} />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </Reveal>
    </Stagger>
  );
}
