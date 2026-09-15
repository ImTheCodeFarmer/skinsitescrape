/**
 * Browser transport. Rustypot (and likely the other sites) sit behind a
 * Cloudflare managed challenge that rejects Node clients and headless Chrome,
 * but clears a real, headed Chrome. So we run Chromium with a real window
 * (under Xvfb in production), load the site, and tap the page's own
 * socket.io websocket frames. The page's client does the subscribing; we
 * only read.
 *
 * Recovery ladder: websocket closed -> reload page; page stuck on the
 * challenge or silent for too long -> relaunch browser.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import type { Logger } from "pino";
import type { SiteAdapter, IncomingEvent } from "./adapter.js";
import type { TransportHooks, Transport } from "./transport.js";
import { parseSocketIoFrame } from "./frames.js";

const UA_ARGS = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];
const SILENCE_MS = 120_000; // relaunch if no frames for this long
const CHALLENGE_MS = 90_000; // relaunch if still on the challenge page after this long

export function connectBrowser(adapter: SiteAdapter, hooks: TransportHooks, log: Logger, proxyUrl?: string): Transport {
  const pageUrl = adapter.connection.pageUrl ?? new URL(adapter.connection.url).origin.replace(/^ws/, "http") + "/";
  const proxy = proxyUrl ? new URL(proxyUrl) : null;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let closed = false;
  let lastFrame = Date.now();
  let connected = false;
  let watchdog: NodeJS.Timeout | null = null;
  let relaunchDelay = 5_000;

  const emit = (event: string, ...args: unknown[]) => {
    log.debug({ event, args }, "emit ignored: browser transport is read-only");
  };

  async function launch() {
    if (closed) return;
    try {
      browser = await chromium.launch({
        headless: false,
        executablePath: process.env.CHROME_PATH || undefined,
        channel: process.env.CHROME_PATH ? undefined : process.env.CHROME_CHANNEL || undefined,
        args: UA_ARGS,
        proxy: proxy
          ? { server: `${proxy.protocol}//${proxy.host}`, username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) }
          : undefined,
      });
      browser.on("disconnected", () => {
        if (closed) return;
        log.warn("browser disconnected");
        setConnected(false, "browser disconnected");
        scheduleRelaunch();
      });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      page = await ctx.newPage();
      // The site may open and drop sockets during its own redirects/navigation.
      // Track live sockets and only reload once none are left for a few seconds.
      const liveSockets = new Set<string>();
      let reloadTimer: NodeJS.Timeout | null = null;
      page.on("websocket", (ws) => {
        if (!ws.url().includes("socket.io")) return;
        const key = `${ws.url()}#${Math.random().toString(36).slice(2, 8)}`;
        liveSockets.add(key);
        if (reloadTimer) {
          clearTimeout(reloadTimer);
          reloadTimer = null;
        }
        log.info({ url: ws.url(), live: liveSockets.size }, "websocket opened");
        setConnected(true);
        ws.on("framereceived", ({ payload }) => {
          lastFrame = Date.now();
          const s = typeof payload === "string" ? payload : payload.toString();
          const parsed = parseSocketIoFrame(s);
          if (!parsed) return;
          const evt: IncomingEvent = { event: parsed.event, args: parsed.args, receivedAt: new Date() };
          hooks.onEvent(evt);
        });
        ws.on("close", () => {
          liveSockets.delete(key);
          if (closed || liveSockets.size > 0) return;
          log.debug("websocket closed, waiting for the page to reconnect");
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            if (closed || liveSockets.size > 0) return;
            log.warn("no live websocket for 8s, reloading page");
            setConnected(false, "websocket closed");
            void page?.reload({ waitUntil: "domcontentloaded" }).catch(() => scheduleRelaunch());
          }, 8_000);
        });
      });
      page.on("crash", () => {
        log.error("page crashed");
        scheduleRelaunch();
      });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      lastFrame = Date.now();
      relaunchDelay = 5_000;
      startWatchdog();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "launch failed");
      hooks.onError(msg);
      scheduleRelaunch();
    }
  }

  function setConnected(v: boolean, reason = "") {
    if (v && !connected) {
      connected = true;
      hooks.onConnect();
    } else if (!v && connected) {
      connected = false;
      hooks.onDisconnect(reason);
    }
  }

  function startWatchdog() {
    if (watchdog) clearInterval(watchdog);
    watchdog = setInterval(async () => {
      if (closed || !page) return;
      const silent = Date.now() - lastFrame;
      let title = "";
      try {
        title = await page.title();
      } catch {
        /* page gone */
      }
      const onChallenge = /just a moment|attention required|access denied/i.test(title);
      if ((onChallenge && silent > CHALLENGE_MS) || silent > SILENCE_MS) {
        log.warn({ title, silentMs: silent }, "watchdog: relaunching browser");
        hooks.onError(onChallenge ? "stuck on cloudflare challenge" : "feed silent");
        scheduleRelaunch(0);
      }
    }, 15_000);
    watchdog.unref();
  }

  let relaunching = false;
  function scheduleRelaunch(delay = relaunchDelay) {
    if (closed || relaunching) return;
    relaunching = true;
    relaunchDelay = Math.min(relaunchDelay * 2, 120_000);
    setTimeout(async () => {
      await teardown();
      relaunching = false;
      await launch();
    }, delay);
  }

  async function teardown() {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    setConnected(false, closed ? "shutdown" : "relaunch");
    const b = browser;
    browser = null;
    page = null;
    await b?.close().catch(() => {});
  }

  void launch();

  return {
    emit,
    close: async () => {
      closed = true;
      await teardown();
    },
  };
}
