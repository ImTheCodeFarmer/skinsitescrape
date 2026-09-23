"use client";

import * as React from "react";
import Script from "next/script";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

export type TurnstileHandle = { reset: () => void };

/**
 * Cloudflare Turnstile widget. Calls `onToken` with a fresh token when the
 * visitor passes (usually without clicking anything) and with "" when the
 * token expires or errors. Tokens are single-use: call `reset()` through
 * the ref after each submit.
 */
export function Turnstile({ siteKey, action, onToken, ref }: { siteKey: string; action?: string; onToken: (token: string) => void; ref?: React.Ref<TurnstileHandle> }) {
  const box = React.useRef<HTMLDivElement>(null);
  const id = React.useRef<string | null>(null);
  const cb = React.useRef(onToken);
  React.useEffect(() => { cb.current = onToken; }, [onToken]);
  const [ready, setReady] = React.useState(() => typeof window !== "undefined" && Boolean(window.turnstile));

  React.useImperativeHandle(ref, () => ({ reset: () => { if (id.current && window.turnstile) { window.turnstile.reset(id.current); cb.current(""); } } }), []);

  React.useEffect(() => {
    if (!ready || !box.current || !window.turnstile || id.current) return;
    id.current = window.turnstile.render(box.current, {
      sitekey: siteKey,
      action,
      theme: "dark",
      callback: (t: string) => cb.current(t),
      "expired-callback": () => cb.current(""),
      "error-callback": () => cb.current(""),
    });
    return () => { if (id.current) window.turnstile?.remove(id.current); id.current = null; };
  }, [ready, siteKey, action]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setReady(true)} />
      <div ref={box} className="min-h-[65px]" />
    </>
  );
}
