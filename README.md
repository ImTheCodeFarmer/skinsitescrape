# casino-stats

Dashboard plus collector for skin-casino activity (Clash.gg, RustClash,
Rustyloot, Rustypot, Cases.gg, CSGOGem, RustEasy). pnpm monorepo.

```
apps/web         Next.js + shadcn dashboard (currently on sample data)
apps/collector   Node service that watches each site's websocket feed and writes to Postgres
packages/db      Shared Drizzle schema + SQL migrations (TimescaleDB)
```

## Local setup

```bash
pnpm install
cp .env.example .env          # fill in PROXY_URL
docker compose up -d db       # TimescaleDB on localhost:5437
pnpm db:migrate
pnpm --filter collector build:wstap   # needs Go 1.24+
pnpm dev:collector
pnpm dev                      # dashboard on http://localhost:3000
```

See "Getting past Cloudflare" for how the collector connects.

## Data model

| Table | What it holds |
|---|---|
| `raw_events` | Every websocket message verbatim (hypertable, compressed after 3 days). Replay source. |
| `players` | One row per site + site user id. `is_house` marks the site's own bot (Rustypot's "JIMMY"). |
| `bets` | Generic fact table, one row per player per settled round, any game (hypertable). |
| `coinflips`, `jackpots`, `jackpot_entries` | Game-specific detail. |
| `bets_hourly`, `bets_daily`, `player_daily` | Continuous aggregates. The dashboard reads these. |
| `flips_daily`, `jackpots_daily`, `bets_daily_records` | Daily rake, house-bot wins/losses and per-day maxima; the profit breakdown and records read these. |
| `streaks` | Longest coinflip win streak per site and window, recomputed hourly by the `refresh_streaks` TimescaleDB job. |
| `collector_status` | Heartbeat per site so gaps in the data can be flagged. |

Money columns are USD as reported by the site. House net is `wagered − payout`
over real players, so tax and house-bot wins both land in it.

`coinflips` and `jackpots` are hypertables keyed by `(site, external_id,
created_at)`, so `created_at` must be a pure function of the round id:
writers derive it with `objectIdTime()` (Rustypot ids are Mongo ObjectIds).
Completed days live in the aggregates; only today is computed live, so page
cost does not grow with the range. After any backfill, reparse or migration
that creates a new aggregate, run `pnpm --filter collector backfill
--refresh-caggs` once to materialize history (the policies only look back a
few days); it also recomputes `streaks`.

## Getting past Cloudflare (socket only, no browser)

Rustypot fronts its socket.io endpoint with a Cloudflare managed challenge
that scores the client's fingerprint. Plain Node clients, curl-impersonate and
headless Chrome all get a 403. `apps/collector/wstap` is a small Go program
that passes it: uTLS sends Chrome 152's exact ClientHello (verified JA4 match,
including the trust-anchor extension 51764 and GREASE in signature
algorithms) and the upgrade request is written byte-for-byte in Chrome's
header order. The collector spawns it and speaks NDJSON over stdio.

What Cloudflare checks, as established by testing:

| Signal | Requirement |
|---|---|
| TLS ClientHello | Must match a real Chrome. `wstap -fp` prints our JA4; compare with a browser. |
| HTTP/1.1 upgrade | Chrome's header order. `Connection` must be second. |
| User-Agent OS vs TCP stack | Must agree. `wstap` picks Linux/macOS/Windows UA from the OS it runs on. |
| Egress IP reputation | Clean IPs (home ISP, and hopefully Railway) pass on fingerprint alone. Residential proxy pools get challenged and need a clearance cookie. |

**Using a proxy.** Residential pools hand out exits of mixed reputation and
Cloudflare challenges most of them, roughly five in six on the `low` pool.
The collector therefore *hunts*: it appends a fresh `_session-<id>` to the
proxy username on every refusal, keeps the exit that connects, and hunts
again only after the connection drops. Set `PROXY_URL` to the bare pool
credentials and leave `PROXY_STICKY=true`. Expect a few seconds to a minute
of hunting per (re)connect; `PROXY_HUNT_MAX` (default 40) refusals in a row
triggers a five-minute pause. If you pin a session yourself (username already
contains `_session-`), hunting is off and refusals back off from 30s to 10 min.

A `cf_clearance` cookie (`WS_COOKIE` + `WS_UA`) also gets a challenged exit
through, but it is bound to the minting IP and the pool's sessions rotate
within minutes, so it is not worth the browser it takes to mint.

`TRANSPORT=browser` (headed Chrome, taps the page's own websocket) and
`TRANSPORT=socketio` (plain client) remain as fallbacks for Socket.IO sites;
only `wstap` speaks the raw protocols CSGOGem and Cases.gg use.

The checked-in `apps/collector/wstap/wstap` is whatever machine last ran
`build:wstap` (a macOS arm64 build at the time of writing); the Docker image
builds its own. Without Go installed, build one for this machine with
`docker run --rm -v "$PWD/apps/collector/wstap":/src -w /src -e CGO_ENABLED=0 golang:1.24 go build -o wstap .`

## CSGOGem

`wss://api.csgogem.com/` is a plain websocket, not Socket.IO: every frame is
`[id, event, data]`. The client sends `[n, "subscribe", ["battle", ...]]`
and gets `[n, null, {battle: true}]` back (an error name in place of `null`
otherwise). Server pushes carry id `-1`. The adapter declares
`protocol: "raw"` and `wstap` connects to the URL verbatim; there was no
Cloudflare challenge on this host as of 2026-09-15, so it works with or
without a proxy. The server compresses with permessage-deflate *with context
takeover*, which is why `wstap` keeps the last 32 KiB of inflated output as
the dictionary for the next message.

Money on the wire is cents of the site coin; the coin's USD price arrives on
`app.onFxRateUpdate` (0.60 when this was written) and the adapter converts
with the live rate.

| Mode | Namespace | What we get | `game` |
|---|---|---|---|
| Case battles | `battle` | Full lobbies, seats, final `payouts`, game end. House bots are `bot-N` (`is_house`). | `battles` |
| Slide | `slide` | Round, wager deltas, winning multiplier. Payout = floor(stake × target) when target ≤ result. | `slide` |
| Double | `roulette` | Round, per-user colour totals, winning colour. Red/black 2×, green 14×. | `roulette` |

**Not tracked:** upgrader, mines and tiles (keno) only broadcast wins on the
public socket (`upgrade.onWin`, `mines.onLiveGame`, `keno.onLiveGame`), so
neither volume nor house net can be measured, and case openings are not on
the socket at all (`case` is rejected). The dashboard says so on the
CSGOGem page.

## Cases.gg

Two plain websockets, both `[event, data]` frames (`protocol: "pair"`), both
behind Cloudflare and both fine through `wstap` without a proxy as of
2026-09-16. The collector runs them as two connections of the one site
(`ADAPTERS.cases` is a list); the status row counts the site as connected
only while both are up, and `reparse` replays raw rows through both.

- `wss://ws.cases.gg/`: send `["subscribe", "battles"]` and
  `["subscribe", "item-coinflip"]` (at most ten channels; `chat`, `rain`,
  `raffles` and `battle-<id>` also exist). `online` ticks every few seconds.
- `wss://cgs.cases.gg/`: crash, streamed to everyone. Raw rows from it are
  stored as `crash:<event>`; `tick` is kept only when it carries a cashout.

Money is cents of USD on both. Bots have a per-game `botId` and become the
shared house players `bot-1`, `bot-2`, …

| Mode | Feed | Settlement | `game` |
|---|---|---|---|
| Case battles | `battles:new/join/join-bots/round/finished` | Every seat pays `joinPrice`; each winner gets floor(total drop value / teamSize), the site's own formula. Group mode is that with one team. A seat on a loan (`borrowMultiplier` t > 1) paid `joinPrice / t` and keeps `(1/t)(1 − 0.01(t − 1))` of its winnings; the row stores the player's figures, the seat's gross in meta. Battles already running at connect are never settled (no lobby list on the socket). | `battles` |
| Item coinflip | `item-coinflip:new/update` | Each player's stake is their items' listed value; the winner is assumed to take everything (`meta.payoutAssumed`), as no game ran during discovery and the history endpoint was empty. | `coinflip` |
| Crash | `status`, `bet`, `tick`, `historyEntry` | Settled on the `ended` status, which lists every bet: cashouts pay the tick's `winnings`, the rest lose. | `crash` |

**Not tracked:** mystery box openings and the upgrader have no public feed
(HTTP only). `battles:double-down` and `battles:awaiting-eos` are raw only.

## RustEasy

Socket.IO at `wss://api.rusteasy.com/socket.io/` with `userStatus=guest` on
the query (`connection.query`); the `sid` a browser adds is Engine.IO's own
session id and is never sent. Behind Cloudflare, fine through `wstap` without
a proxy as of 2026-09-16. Feeds are rooms joined with `joinRoom <name>`;
many payloads are JSON strings and are unwrapped by the adapter. Money is
USD ("gems", 1:1). The house plays as "Tunnel Dweller" (steamid64 `0`) in
coinflip, jackpot and champion; battle bots are `bot-<seat>`.

| Mode | Room / events | Settlement | `game` |
|---|---|---|---|
| Case battles | `casebattles`: `newCaseBattle` (twice: created, then started with seats), `battles:round` (a drop per seat and the running `unboxed_amount`), `battles:finished`; plus each battle's own room `battle-<key>`, joined on creation, for `caseBattleWinner` | Every seat pays `total_value`, less `borrow_percent` of it for real players when the creator turned borrow mode on, and a borrowed seat keeps only that same fraction of its winnings (verified on battle CWnl4LuJ4Px7qy8I: $297.79 staked of $1,488.96, $1,134.73 received of a $5,673.63 share). Winning seats split the final unboxed amount; shared mode splits it over everyone, cursed and jackpot modes only change who `winner` names. Team modes seat 1..n/2 on team 1. The site's `winnerPrize` figure is kept in `meta.siteWinningsUsd` for comparison. Battles already running at connect are skipped. | `battles` |
| Coinflip | `coinflip`: `newCoinflipGame`, `coinflipGameUpdate` (status 2 joined, 4 finished with `winner_side`) | Winner takes both stakes less the fee: the event's `fee` if present, else the FAQ's 7% (`taxEstimated`). | `coinflip` |
| Jackpot | `jackpot`: `newDeposit` (whole round), `slider` (draw with winner), `newGame` | Each player's deposits summed; winner takes the pot less an estimated 7% (FAQ). | `jackpot` |
| Double | `roullete`: `roullete_bet`, `roullete_slider` | 0 gold 14x, 1 and 14 bait 7x, other evens red and odds black 2x (the client's own scoring). No round id on the feed: a round is named by its spin's `received_at` and placed at its first bet. | `roulette` |
| Champion | `champion`: `challengerInfo` opens a fight, `championEnd` closes it, `newChampionInfo` / `champion` name the holder, who is the winner | Both sides stake their totals; winner takes the pot less an estimated 10% (FAQ). | `champion` |

**Not tracked:** cases, upgrader, mines and bust (blackjack) are private HTTP
games; their only public trace is the `live.wins` ticker (wins only), kept
raw.

## Sign in with Steam

The 24 hour and 7 day views are public and 7 days is the default. The 30
and 90 day views need a signed-in user: a visitor asking for them gets the
page rendered from seeded placeholder numbers (`lib/sample.ts`), blurred
and inert, with a sign-in card on top, and `/api/live` answers 401 for those
ranges so nothing real leaks through the poll.

Sign-in is Steam OpenID (`lib/auth.ts`): `/api/auth/steam` bounces the
browser to Steam, `/api/auth/steam/return` verifies the assertion with Steam
(`check_authentication`), reads the display name and avatar from the public
XML profile (no API key needed) and sets an HMAC-signed, HttpOnly cookie
holding the Steam id; `POST /api/auth/logout` clears it. Nothing is stored
server-side. `SESSION_SECRET` signs the cookie (a key derived from
`DATABASE_URL` is used when it is unset) and `NEXT_PUBLIC_SITE_URL` fixes
the return address when the app sits behind a proxy.

## Live updates

Pages are server-rendered once, then kept current by the client. Each page
seeds a TanStack Query cache with its server props and polls
`/api/live?site=<slug|all>&range=<n>&since=<ISO>` every 3 seconds while
the tab is visible. A tick returns only what moves: the current and previous
bucket of the chart, the small aggregates (KPIs, top players, top games,
records, profit breakdown) and rounds settled after `since`. The client merges
them into the data it already holds, so a tick is a few kilobytes and a few
milliseconds of database time regardless of range. Long-range numbers come
from the continuous aggregates, where completed days are materialized; only
today is computed live.

## Importing legacy history

`apps/collector/src/backfill` pulls the old scraper's Postgres into this
schema. Each legacy table is a *source* walked in primary-key order; every
row becomes the same `players` / `bets` / `coinflips` / `jackpots` upserts the
live collector writes, tagged `meta.legacy = true`. Progress per source lives
in `backfill_progress`, so a crash, `Ctrl-C` or redeploy loses at most one
batch and the next run continues where it stopped. Re-running after the
legacy scraper has written more simply picks up the new rows.

```bash
# .env: DATABASE_URL (target) + LEGACY_DB_HOST / LEGACY_DB_NAME / LEGACY_DB_USER / LEGACY_DB_PASSWORD
pnpm db:migrate                                   # 0004 adds backfill_progress + site rows
pnpm --filter collector backfill --list           # sources, saved cursors, unit conversions
pnpm --filter collector backfill --sources rustypot --max-batches 3 --dry-run   # rehearse
pnpm --filter collector backfill                  # default set, then refresh aggregates
pnpm --filter collector backfill --refresh-caggs  # aggregates only
```

In production the same entry point is `node dist/backfill/main.js` inside the
collector image (`railway ssh`, or `railway run` locally with the service's
variables). Run it with the collector still up; the two never write the same
row twice in a conflicting way.

| Source | Legacy table | Becomes |
|---|---|---|
| `rustypot` | `events` (coinflips + jackpots) | `coinflips` + 2 `bets` per flip; `jackpots` only (no deposits survived, so no jackpot bets) |
| `clash-battles`, `rustclash-battles`, `cases-battles` | `*_case_battle_events` | one `bets` row per real player; a null `winning_team` on a finished battle is a bot win |
| `csgogem-battles` | `csgogem_battles_users` | per-player paid / won straight from the row |
| `rustyloot-battles` | `rustyloot_case_battle_users` + winners | stake net of `borrow_percent`; winners rows are the payout |
| `clash-plinko`, `rustclash-plinko` | `*_plinko_bets` | `bet × multiplier` |
| `clash-roulette`, `rustclash-roulette` (opt-in) | `*_roulette_bets` + games | payout from `BACKFILL_ROULETTE_WHEEL`; the legacy scraper never stored payouts and the wheel layout is unverified |
| `banditcamp-battles`, `rustmagic-battles` (opt-in) | `*_case_battles` | sites not on the dashboard; RustMagic amounts do not reconcile |

Money: legacy rows are in each site's native units; `config.ts` converts to
USD (Clash/RustClash cents of gems at $0.60, the rest cents at $1) and
`BACKFILL_USD_<SITE>` overrides a site. Only `currency = 'REAL'` rows count.

**Cutoff.** Before walking a source the script finds the earliest row the live
collector wrote for that site/game and skips legacy rows from that instant
on, so the live feed owns everything after it started. `--until <ISO>`
overrides. Rustypot ids are the site's own, so an overlap merges rather
than duplicates anyway.

**Load.** Legacy side: one read-only connection, primary-key range scans of
`--batch` rows (default 1000) and indexed `= ANY(ids)` lookups; the small
user tables are read once per run instead of per batch because the legacy
disk is slow at random reads. Target side: one multi-row upsert per table per
batch, `--pause` ms between batches (default 250), two connections. Expect
1-2k legacy rows/s; the default set is a few hours. The newest
`--tail` minutes (default 15) of legacy rows are left for the next run so
in-flight games have settled.

**Aggregates.** The continuous-aggregate policies only look back a few days,
so after the sources catch up the script refreshes `bets_hourly`,
`player_daily` and `bets_daily` over the imported range in weekly windows
(`--refresh-caggs` runs just that; `--no-refresh` skips it). Until then the
dashboard's 24h view and site list will not show the history. If a long
import spans more than a day, consider pausing the `bets` compression policy
first (`SELECT alter_job(job_id, scheduled => false) FROM timescaledb_information.jobs WHERE proc_name = 'policy_compression' AND hypertable_name = 'bets'`)
and re-enabling it afterwards, so late-arriving upserts do not land in
compressed chunks.

## Adding a site

1. `pnpm --filter collector discover <site> 180` — connects for three minutes,
   tallies event names, and saves samples to `apps/collector/discover/`.
2. Write `apps/collector/src/adapters/<site>/` with a `SiteAdapter` that maps
   events to `sink.player / bet / coinflip / jackpot` calls. Keep the full
   payload in `meta` for anything you're unsure about.
3. Register it in `apps/collector/src/adapters/index.ts` and add the site to
   `SITES`.
4. If a parser was wrong, fix it and run `pnpm --filter collector reparse <site>`
   to re-derive everything from `raw_events`. All writes are idempotent. In
   production the same script is `node dist/scripts/reparse.js <site>` inside
   the collector container (`railway ssh`), after the fixed adapter has been
   deployed.

## Rustypot notes

- Coinflip lifecycle: `cf newLobby` (Open) → `updateCFStatus` (Joining,
  Flipping, Ended). `Ended` carries `winner.{id, coin}` and `completedDate`.
  `cf RemoveLobby` fires for cancelled lobbies **and** after finished flips.
- Jackpot rounds are only named when they end. Deposits arrive as bare rows
  (`jackpot deposit`, one per transaction; a player can appear more than once),
  and `jackpot winnerInfo` brings the round `_id`. The adapter holds the round
  in memory until then. Rounds joined mid-way are flagged `meta.partial` and
  get no `bets` rows, so they never skew the rollups.
- The feed does not state the tax taken on a flip or pot. Both are recorded as
  a 10% estimate and flagged with `meta.taxEstimated = true`. If the exact
  figure surfaces (for example in the trade offer), adjust
  `COINFLIP_TAX_RATE` / `JACKPOT_TAX_RATE` and reparse.
- `gamemode_totals` (live pot sizes) and `new BiggestBet` are stored raw only.

## Deploying to Railway

Three services in one project:

1. **db** — deploy the `timescale/timescaledb:latest-pg16` image with a volume
   mounted at `/var/lib/postgresql/data`. Set `POSTGRES_PASSWORD`.
2. **collector** — root directory `/`, Dockerfile `apps/collector/Dockerfile`.
   Env: `DATABASE_URL` (reference the db service's private URL),
   `SITES=rustypot`, `PROXY_URL` (the `low_country-US` pool works with hunting; try
   without a proxy first and keep it only if Railway's own IP is challenged).
   ~256 MB RAM is plenty. Migrations run on boot.
3. **web** — root directory `apps/web`, Nixpacks default. Env: `DATABASE_URL`,
   `SESSION_SECRET` (any long random string; signs the login cookie) and
   `NEXT_PUBLIC_SITE_URL` (the site's public URL, so Steam sends users back
   to the right host).

Add a nightly `pg_dump` cron to object storage; the volume is a single node.
