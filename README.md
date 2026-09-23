# casino-stats

Dashboard plus collector for skin-casino activity (Clash.gg, RustClash,
Rustyloot, Rustypot, Cases.gg, Clash.gg, CSGOGem, RustEasy, Bandit.camp,
RustMagic, CSGORoll). pnpm monorepo.

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

`-binary` mode (used for `protocol: "socketio-msgpack"`, RustBattle) emits
binary frames as `{"b":"<base64>"}`, sends stdin lines `b:<base64>` as binary
frames, and leaves the Socket.IO connect packet to the collector, which
encodes it with MessagePack (`core/msgpack.ts`, a small codec covering what
socket.io-msgpack-parser emits, including notepack's `undefined` extension).

`TRANSPORT=browser` (headed Chrome, taps the page's own websocket) and
`TRANSPORT=socketio` (plain client) remain as fallbacks for Socket.IO sites;
only `wstap` speaks the raw protocols CSGOGem, Cases.gg, Bandit.camp and
CSGORoll use (`-subprotocol` asks for a websocket subprotocol, which
CSGORoll's GraphQL endpoint requires).

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

## Cases.gg, Clash.gg and RustClash (the Clash platform)

All three sites run the same platform: two plain websockets, both `[event, data]`
frames (`protocol: "pair"`), all behind Cloudflare and fine through
`wstap` without a proxy as of 2026-09-16 (RustClash needed a short proxy
hunt from a residential exit on 2026-09-19). The handlers live in
`adapters/clash-family/` as per-site factories; `adapters/cases`,
`adapters/clash` and `adapters/rustclash` are thin configurations. Each site runs as two connections
(`ADAPTERS.<site>` is a list); the status row counts the site as connected
only while both are up, and `reparse` replays raw rows through both.

Clash.gg: `wss://ws.clash.gg/` (channels `battles`, `roulette`, `plinko`,
`champion-match`) and `wss://gs.clash.gg/` for crash. Money is cents of
gems at **$0.60 per gem** (`GEM_USD`), the legacy dashboard's rate, and
what the feed's item prices give against Steam prices. Only
`currency: "REAL"` counts. Clash.gg's HTTP side challenges plain clients,
so its pages and chunks were read with a Chrome-impersonating fetch; the
sockets need nothing special.

| Clash.gg mode | Feed | Settlement | `game` |
|---|---|---|---|
| Case battles | as Cases.gg below, same loan rule | same | `battles` |
| Double | `roulette:bet`, `roulette:round` (DRAWING carries `outcome` 0..14) | 0 green 14x, 1..7 red 2x, 8..14 black 2x, and 4 and 11 also pay bait 7x, per the site's client. | `roulette` |
| Plinko | `plinko:social-game`, one event per other player's ball | bet × multiplier; no round id, so named by arrival time and player. | `plinko` |
| Champion | `champion-match:<TYPE>:round-update` (a fight: champion and challenger with their stakes) and `:match-finish` (`winner`, `paidAmount`) | Every entrant stakes their `amount` once; the winner is paid `paidAmount`. Sessions joined mid-way (payout above the stakes seen) are skipped. | `champion` |
| Crash | as Cases.gg | same | `crash` |

**Clash.gg, not tracked:** case openings, the upgrader, mines and tiles are
private games whose only public trace is the `drops` ticker (wins only).

RustClash: `wss://ws.rustclash.com/` (channels `battles`, `roulette`,
`plinko`; no champion game) and `wss://cgs.rustclash.com/` for crash (the
Cases.gg host name, not Clash.gg's `gs.`). Cents of gems at $0.60, the same
`GEM_USD`. Battles, Double, Plinko and Crash settle exactly as Clash.gg
above and land under the same `game` names. Battle pages are
`https://rustclash.com/battles/<id>`.

**RustClash, not tracked:** case openings, the upgrader, mines, roll and
tiles. A real Chrome on each of those pages opened no socket channel, and
subscribing to `roll`, `drops` and `crash` on the main socket produced
nothing, so they are private HTTP games with no public feed.

Cases.gg: `wss://ws.cases.gg/` and `wss://cgs.cases.gg/`, cents of USD.

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

## Bandit.camp

`wss://api.bandit.camp/` is a plain websocket, not Socket.IO: frames are
objects, `{"a":[event, ...args], "i":id}`, answered by `{"i":id, "d":data}`
or `{"i":id, "e":{message}}` (`protocol: "envelope"`; replies reach the
adapter as `ack` / `nack`). Behind Cloudflare, fine through `wstap` without a
proxy as of 2026-09-17. Rooms are joined with `subscribe <room>`. Amounts are
scrap in hundredths, converted at the site's own rate from `app.conga`
(`withdrawals.crypto.scrapRateUsd`, $0.65 per scrap on 2026-09-17; the
legacy backfill uses the same figure). The
site's bots are `banditcamp-<n|colour>` and are stored as house players.

| Mode | Room / events | Settlement | `game` |
|---|---|---|---|
| Crate Battles | `caseBattles`: `active` (snapshot), `new`, `playerJoined`, `finished` (`winningTeams`, `totalWon`), `expired`. `rollRound` (one per case) is never stored. | Every seat on a winning team, bots included, takes an equal share of `totalWon`; that covers jackpot mode and group unboxes. A seat costs `price`; with `funding` joiners pay price − ceil(price × funding%) and the creator's stake carries the rest for every other seat (that this includes bot-filled seats is an assumption). | `battles` |
| Crate Royale | `caseJackpot`: `active`, `new`, `newEntry` (the crates an entry opened and what they unboxed), `roll` (`winningEntryId`, `bonus`) | An entry stakes its crates' prices; the winning entry takes everything unboxed plus the bonus (verified against `recentWin.totalWon`). No rake: the edge is in the crates. Rounds already populated at connect are skipped. | `royale` |
| Wheel of Fortune | `wheel`: `round`, `newBet` (a player's whole bet sheet), `deleteBet`, `roll` (segment index) | Segments `[20,1,3,1,5,1,3,1,10,1,3,5,1,5,1,3,1,10,1,3,1,5,1,3,1]`; a chip on field N pays N to 1. | `wheel` |
| Spinner Battles | `spinners`: `active`, `new`, `joined`, `roll` (`data.winner`), `expired` | Winner takes the pot less the rake from `app.conga` (5%). Games that only show in the wins ticker (presumably private) are not tracked. | `spinners` |
| Crate Unboxing | no room: the wins ticker `games.feed.new`, which for crates carries every opening, losses included | Stake is the crate's price from `game.cases.list` (refreshed hourly) times the items opened. The ticker runs about 40 minutes behind and has no timestamp, so openings are dated when received (`meta.feedDelayed`). Openings with a `jackpotId` belong to a Crate Royale entry and are skipped. | `cases` |

**Not tracked:** Minefield Madness, Scrap Upgrader and Beancan Blast (`dice`
on the wire) are private request/reply games; the wins ticker never shows a
loss for them, so it is kept raw only.

## RustMagic

Socket.IO at `wss://api.rustmagic.com/socket.io/` with empty `token` and
`totp` on the query for a guest. Behind Cloudflare, fine through `wstap`
without a proxy as of 2026-09-17. Amounts are hundredths of a coin and a coin
is $0.66 (the site's FAQ). Players are the site's numeric user ids; the feed
carries no Steam ids.

The whole site comes from one room. `betting:join` turns on
`betting:live-bets`, the site's live bet table: one settled bet per message
with its type, player, stake and payout, losses included. Bet ids are a
single sequence across all games, which makes coverage measurable: over seven
minutes, 249 of the 255 ids issued after joining arrived, the rest plausibly
still unsettled (battles report up to two minutes after they are placed).
`date` is the time the bet was placed.

| Bet type | `game` |
|---|---|
| `BATTLE` (real players only; `battle.id` is the round) | `battles` |
| `UPGRADE` | `upgrader` |
| `MINES` | `mines` |
| `KENO` | `keno` |
| `FLIPPER` | `flipper` |
| `ROULETTE` (Magic Wheel) | `roulette` |
| `UNBOXING` (case opening) | `cases` |
| anything with a `slotsGameCode` (third-party slots, about three bets in four) | `slots`, title and code in `meta` |
| `COINFLIP`, `CRASH` (in the client's enum, not on the site today) | `coinflip`, `crash` |

Only `allBets` is stored raw; the message's other lists repeat it. The
`game_battles` and `game_roulette` rooms have round detail but nothing the
stats need, so they are not joined.

## Rustyloot

Socket.IO at `wss://api.rustyloot.gg/socket.io/` with `language=en` on the
query. Behind Cloudflare, fine through `wstap` without a proxy as of
2026-09-17. Rooms are joined with `<game>:connect {}`. Amounts are
thousandths of a coin and the site sells 1.55 coins to the dollar (its
deposit forms), so a coin counts as $1 / 1.55. House bots carry no id and
are stored as `bot-<game>-<seat>`.

| Mode | Source | Settlement | `game` |
|---|---|---|---|
| Case battles | room `battles`: `battles:new`, `battles:newPlayer`, `battles:results` | Winning seats, bots included, split `totalValue`. **Borrow:** a seat with `borrowPercent` b stakes floor(price × (1 − b/100)) and keeps floor(share × (1 − b/100)); the floor is taken in floating point, as the site does, and every battle in a ten minute capture matched the site's own ticker row to the coin (an 80% borrower of a 43,140 seat paid 8,627 and received 6,840 of a 34,202.5 share). `fundPercent` is applied as a discount to joiners and a cost to the creator, by assumption: it was 0 throughout. Battles running at connect are skipped. | `battles` |
| Wheel | room `wheel`: `wheel:updateState` (the ended state carries every bet) | gray 2x, blue 3x, purple 6x, green 12x, yellow 22x, times `zapMultiplier` when the winning tile was zapped (the client's rules). | `wheel` |
| PVP Mines | room `pvpmines`: `pvpmines:update` | Every seat stakes `value`; the winner receives `winner.value` (10% rake). | `pvpmines` |
| Coinflip | room `coinflip`: `coinflip:update` | Item flip, roughly hourly. Winner is credited `total`; the site's cut is not on the feed (`meta.taxUnknown`). | `coinflip` |

**Not tracked:** Plinko, Upgrader, Mines and Cases are private games. Their
only public trace is `betting:live-bets`, the site's live bet table, which
does show losses but carries no bet or user ids and is dripped at one row a
second, so its completeness under load is unknown. By decision on 2026-09-17
it is not collected, not even raw.

Chat is watched but not stored: every message carries the speaker's site id
and `steamid`, which become `player_identities` rows (see "Player profiles
and identity links").

## CSGORoll

GraphQL subscriptions over `graphql-transport-ws` at
`wss://www.csgoroll.com/ws` (`protocol: "graphql"`: the transport asks for
the subprotocol, sends `connection_init`, treats `connection_ack` as the
connect and answers the server's pings; `emit(name, query, variables)`
subscribes with `name` as the message id, so `next` messages arrive as event
`name`). Behind Cloudflare, fine through `wstap` without a proxy as of
2026-09-18, though a burst of a dozen connections in a few minutes got the
IP challenged for about twenty minutes. A guest may subscribe but not query
(any `query` closes the socket with 4401), so the lobbies the site loads over
HTTP are out of reach and only pushed data counts. Amounts are decimal coins
(`TKN`); the site's own `ExchangeRateList` gives $0.70 a coin, and its Case
Royale rows confirm it (`totalBet` 10.58 TKN, `totalBetBase` 7.406 USD).
Values it labels `USD` are USD. Ids are Relay ids (`QmF0dGxlOjQwMDUwNDU`,
base64 of `Battle:4005045`), kept verbatim because the site's URLs use them.

| Mode | Subscription | Settlement | `game` |
|---|---|---|---|
| PVP 2.0 (case battles) | `battleUpdated(statuses: [FINISHED, CANCELLED])`, with a document asking for the whole battle, so one message carries the seats, `won` flags, seat cost and `totalPulled` | Every seat pays `costOriginal` (the rounds' box costs); the seats with `won` split `totalPulled` (USD) equally, exact for a single winner and for `T<n>` group mode where everyone wins, assumed for team modes. `sponsorship.percentage` is taken off every other seat and onto the creator's, by assumption (it was null throughout). Battles paid in `BOX_KEY` are kept raw only. The house's "Bot #n" users are stored as house players. | `battles` |
| Roll | `createGame`, `createBet` (no game id: it belongs to the latest created game), `updateGame` (`rollValue` 0..14) | A bet pays 14 divided by the number of `selections` when the roll is among them: 0 green 14x, 1..7 red or 8..14 black 2x, [4, 11] bait 7x. Bets seen before the first `createGame` after a connect are dropped. | `roulette` |
| Crash | `createCrashGame`, `createCrashBet`, `updateCrashBet` (a cash-out: `tick`, `totalWinAmount`), `updateCrashGame` (FINISHED with `roll` in hundredths, or `cancelledReason`) | Cashed-out bets take `totalWinAmount`, the rest lose. Bets on a game whose creation was not seen are settled anyway and marked `partial`. | `crash` |
| Dice and Upgrader | `createDiceBets`, every bet on the site, losses included, `gameType` DICE or UPGRADE | `totalBet` and `totalPayout` as sent. | `dice`, `upgrader` |
| Case Royale | `createOrUpdateBoxJackpotPlayer` (`totalBetBase` in USD, `won` once drawn, the game's `totalPayout`); `updateBoxJackpotGame` raw only | Each entrant stakes `totalBetBase`; the one with `won` takes `totalPayout`. Inferred from the schema and the site's history query, not yet observed live (about one round an hour). | `royale` |

**Not tracked:** case openings, Arms Dealer and Cluck 'n' Boom (mines) are
private games whose only public trace is the chat's big-win messages;
esports only pushes match odds; Plinko's `createPlinkoBet` subscription
closes the socket with 4401 for a guest, even with the site's own document.

## Splits.gg

Socket.IO at `wss://splits.gg/socket.io/`, no auth needed (the browser sends
a session id in the connect payload; guests get everything below without
one). Behind Cloudflare; `wstap` connects without a proxy as of 2026-09-19.

One feed covers the whole site. `newDrop` is the site's live bet ticker,
pushed to every socket with no subscription: each message carries one or
more settled bets in `latestDrops` (repeated in `highrollerDrops` and
`luckyDrops` when they qualify) with the game name, the player, the stake,
the payout and the result, losses included. Over two runs on 2026-09-19
every id in the sequence arrived and the mines feed (`mines:pushHistory`)
matched the ticker one for one, so it is treated as complete. `setDrops` is
the same shape sent once on connect with recent history.

So every mode is tracked from this one feed, including the private ones:
battles (case and skin), coinflip, bust (the site's blackjack; side bets
arrive as their own drops and land under `bust` too), upgrader, wheel,
mines, cases, targets, towers, keno and plinko. Multi-player rounds share a
`gameId`, kept as `round_id`; the drop id is the bet's own id. Game names
are matched by pattern (`GAMES` in `adapters/splits`); an unseen name is
stored under its own slug with a warning, and `reparse splits` re-derives
everything once the map is extended.

Amounts are integer cents of gems at **$1 per gem**: every balance and bet
in the client is `amount / 100`, and a USD deposit buys the same number of
gems (crypto deposits carry a bonus, so those gems cost less). Only
`balanceMode: "gem"` has been seen; other modes are raw only. Players are
the site's numeric user ids. A player who plays anonymously still comes
through with their id; the name and avatar are stored hidden, as the site
shows them.

Raw only: `coinflip:*` and `WOF*` (round detail the stats do not need),
`mines:pushHistory`, `cases:community:open`. Chat, presence, rain,
leaderboards, emoji tallies and the blackjack table's card-by-card stream
are dropped.

## Player profiles and identity links

`/player/<site>/<id>` shows one account and every account on another site
we believe is the same person: totals across them, a profit and loss chart,
game mix and recent bets, then one tab per site. Player names on the
leaderboards and bet tables link there.

Links live in `player_links`, one row per pair of accounts on different
sites with a score from 0 to 1 and the evidence as JSON. Player rows are
never merged; the page reads the links and shows the confidence, so a link
can change or disappear when the evidence does. The
`refresh_player_links` TimescaleDB job recomputes the table from scratch
every hour (migration 0011; run `CALL refresh_player_links(0, NULL)` to
refresh by hand).

| Evidence | Score | Why |
|---|---|---|
| Same Steam64 id | 1.0 | Rustypot, RustEasy and Bandit.camp key players by Steam id. Any site whose ids are Steam64 ids joins automatically: the rule matches the id's shape, not a list of sites. |
| Same Steam profile picture and same name | 0.98 | Sites that pass the `avatars.steamstatic.com` URL through expose its content hash; two accounts share it only when they are the same Steam account or uploaded the same image. Default pictures and any hash owned by more than six accounts are ignored. |
| Same Steam profile picture | 0.9, or 0.75 when a few other accounts share it | |
| Same display name only | 0.35 to 0.45 by length, +0.2 when both were active on 3 or more of the same days, −0.15 when they never were despite regular play on both | Names are normalized to lower-case letters and digits, must be five or more characters, and must be rare (at most four accounts). |

**Steam ids learned from chat.** Some sites do not key players by Steam id
but still reveal it: Rustyloot's chat sends each speaker's site id and
`steamid` together, and its connect handshake carries the recent backlog.
The Rustyloot adapter turns those into `player_identities` rows (site,
site id, Steam id, source) and drops the message itself; nothing from chat
is stored. The link job, the Steam enrichment queue and the profile's
Steam tab all treat a learned id exactly like a Steam-keyed one (migration
0016). Two minutes of listening on 2026-09-20 yielded sixteen mappings.
Other sites' chats can feed the same table if they expose the id.

**Ruled out by Steam id.** On sites that key players by Steam id, two
accounts with different ids are two different Steam accounts, so a shared
name or picture never links them: the job drops such pairs before scoring
(migration 0014). A Bandit.camp player and a Rustypot player with the same
name therefore either link at 100% (same Steam id) or not at all.

**Permanent links.** A pair scored as the same person (0.95 or higher)
is also written to `player_links_confirmed`, keyed by the two sites' user
ids only. Every later run merges those back into `player_links` at no less
than their confirmed score, so a rename or a new profile picture on one
site can lower a freshly computed score but never removes a link that was
once certain. The card shows a lock on such links and the tooltip gives the
confirmation date. Deleting a row from `player_links_confirmed` drops the
link on the next run; inserting one with `source = 'admin'` pins a link by
hand (migration 0012).

The page labels scores as **Same person** (95%+), **Very likely** (70%+),
**Possibly** (40%+) and **Weak match**. Links at 70% or higher count toward
the totals and get a tab; weaker ones are listed with their confidence but
kept out. Following a chain of links (A to B to C) the confidence is the
weakest link, and chains stop after two hops.

Not yet in the score: perceptual hashing of re-hosted avatars (CSGOGem
serves them through Cloudflare Images, so the URL hash is lost), name
similarity short of an exact match, and bet-size or time-of-day profiles.
Anonymous players (stored as "Anonymous") are excluded by the name rule.

## RustBattle

Socket.IO at `wss://api.rustbattle.com/socket.io/` with `x-socket-id` (any
random id) and `language=en` on the query, using **socket.io-msgpack-parser**:
the Engine.IO handshake and pings are text, every Socket.IO packet is a
binary MessagePack object `{type, data, nsp, id?}`. The adapter declares
`protocol: "socketio-msgpack"`; wstap runs in `-binary` mode and the
collector sends the connect packet `{type: 0, data: {token: null}, nsp: "/"}`
itself. Behind Cloudflare; wstap connects without a proxy as of 2026-09-19.

The client asks for a game's state with `<game>:index` and the server
answers with events of the same name, then keeps pushing that game's
changes: `crash:index` (full state on every change, `crash:multiplier`
ticks), `case-battles:store` / `case-battles:update` (the whole battle each
time: teams, seats, case opens and winners), `coinflip:store` /
`coinflip:update`. The adapter emits the three `index` requests on connect.

Amounts are integer cents of coins at **$1 per coin**: the site's own
crypto rates (`crypto:updated`) price USDT at 0.9997 coins. Players are the
site's user UUIDs.

| Mode | Feed | Settlement | `game` |
|---|---|---|---|
| Case battles | `case-battles:update` on `status = "ended"` | Every seat pays `cost` (the case prices for all rounds); a seat's `won` is its payout, already split by the site. Bots (`bot = 1`) are the house, one house player per bot identity. A seat with `borrow_money_amount` was lent money by the site; on the battles read it kept a third of its share and its bot teammate the rest. The stake recorded is still the full `cost`, with the loan in meta, until the site's rule is confirmed. Refunded battles pay the stake back. | `battles` |
| Coinflip | `coinflip:update` / `coinflip:store` once `winning_side` is set | Each user stakes their items' value (or `amount`); the user on `winning_side` is assumed to take the whole pot (`meta.payoutAssumed`). | `coinflip` |
| Crash | `crash:index` on `status = "finished"` | Each `crashUsers` entry stakes `amount`; a cash-out multiplier (hundredths) pays stake × multiplier, the rest lose. | `crash` |

The battle settlement was checked against two battles captured from a
browser. **Coinflip and crash are provisional:** nobody played either while
the feed was read on 2026-09-19 and 2026-09-20 (Chrome on the site saw the
same empty rounds), so their per-bet field names come from the client code
and common usage. Both handlers read the likely names defensively, keep the
raw entry in meta, and warn once on an unrecognised shape; `reparse
rustbattle` re-derives everything after a fix.

**Not tracked:** upgrader, tower, mines, plinko, keno, 21 and case openings
are private games; their pages open no socket channel and nothing about
them is broadcast.

## Telegram alerts

`/alerts` (approved accounts only) walks a user through creating their own
bot with @BotFather, connecting a chat, and writing alert rules. Nothing is
shared between users: each account's alerts go out through that account's
bot.

1. **Token.** The user pastes the token BotFather gave them. The web app
   checks it with `getMe`, then stores it in `alert_bots` encrypted with
   AES-256-GCM under `ALERTS_SECRET` (`packages/db/src/secrets.ts`; falls
   back to `SESSION_SECRET`, then a key derived from `DATABASE_URL`, so the
   web app and the collector agree without extra setup).
2. **Chat.** Bots cannot message a user first, so the user opens the bot and
   presses Start; "Find my chat" reads the bot's `getUpdates` queue, keeps
   the newest chat id (a group works the same way once the bot is in it),
   and sends a hello. "Send a test" checks the path end to end.
3. **Rules** (`alert_rules`): *big bet* (any bet at or above a size), *player
   bet* (one account, optionally above a size; a profile's "Alert me" button
   prefills it) and *big win* (net win at or above a size), each optionally
   limited to a site and a game, with an optional quiet time between sends.
   Up to 50 per account.

The collector evaluates every settled bet it writes against the enabled
rules (`core/alerts.ts`, hooked into the sink; rules reload every 30 s) and
sends through the owner's bot with the site, game, player, stake, result
and, when `PUBLIC_WEB_URL` is set, a link to the profile. A row per (rule,
bet) in `alert_deliveries` keeps re-flushed bets from sending twice; a
failed send is recorded on the bot as `last_error` and shown on the page.

## Steam profile enrichment

For every player keyed by a Steam64 id (Rustypot, RustEasy, Bandit.camp),
the collector fetches what Steam shows publicly into `steam_profiles` and
`steam_aliases` (migration 0015, `core/steam.ts`): persona, picture,
visibility, country, account age, last log-off, VAC and game bans, the
friends list (public ones only, capped at 500 ids) and the profile's past
names, which Steam only exposes on the profile page. The profile page shows
it on a Steam tab, with a "Fetch Steam data" button that runs the same
fetch on the spot when we hold a Steam id but no data yet (same budget); the link job uses the picture hash for accounts whose
site gives none and treats any past alias as a name match
(`evidence.alias`, scored 0.05 below a current-name match).

**Budget, not appetite.** The job is built to stay small at hundreds of
thousands of players:

- One token bucket across every Steam request: `STEAM_RPS` per second
  (default 0.5) and `STEAM_DAILY_MAX` per UTC day (default 15,000). A 429
  from Steam pauses it for ten minutes. It runs off timers inside the
  collector and never touches the sink.
- With `STEAM_API_KEY`, summaries and bans come 100 profiles per request,
  so 100k players cost 2,000 requests. Without a key it falls back to the
  profile XML, one request per profile; aliases are always one request per
  profile and friends one more, so those are only fetched for active
  players.
- Freshness follows activity: players seen in the last 7 days refresh
  every 2 days with aliases and friends, the last 30 days weekly with the
  same, older ones monthly with the summary only. Never-fetched profiles go
  first, newest activity first. A failed fetch is retried after a day.
- `STEAM_ENRICH=false` switches it off; `pnpm --filter collector
  steam-enrich <passes>` runs passes by hand, for example to backfill.

Only ids we already hold are ever looked up, and nothing is redistributed
beyond the dashboard's own profile card.

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

### Admin

`/admin` lists every Steam account that has signed in (`site_users`, one
row per account with first and last sign-in and a count, written by the
Steam return route). Only the Steam ids in `ADMIN_STEAM_IDS` (comma-separated;
defaults to the owner's id in `lib/auth.ts`) can open it; everyone else gets
a 404, and the sidebar shows the Admin link only to them. Migration
`0010_site_users.sql` creates the table.

**Admin players.** A site's owner or staff can bet with money that was never
deposited, so their play says nothing about the site's profit. A dashboard
admin can right-click any player name (bet lists, leaderboards, profiles)
and choose *Mark as admin*; the "Admin players" tab of `/admin` lists the
marked accounts and unmarks them. Marked players' bets are still collected
and shown to admins with an `admin` tag, but count toward no total,
leaderboard, record or alert. Under the hood (`lib/admin-players.ts`,
migration `0017_admin_players.sql`) the mark sets `players.is_admin` and
flips `bets.is_house` on the player's bets, which every continuous aggregate
already filters on, so no aggregate had to be recreated; the collector's
sink joins `players` on insert so new bets by a marked player land with
`is_house` set, and the alert matcher skips them. Because the aggregate
policies only look back a few days, marking or unmarking refreshes
`bets_hourly`, `player_daily`, `bets_daily` and `bets_daily_records` from
the player's first bet onwards after the response is sent (only the
touched buckets are recomputed), then recomputes the streaks. Coinflip and
jackpot rake (`flips_daily`, `jackpots_daily`) is per round, not per
player, and is not affected.

**Streamers.** The same right-click menu has *Mark as streamer*. Unlike the
admin mark it changes no total: the name gets a `streamer` tag in bet lists,
leaderboards and profiles, and the player's profile becomes a streamer
profile, headed by the name they stream under, a bio and buttons for their
channels (Twitch, Kick, YouTube, X, TikTok, Instagram, Discord, a website).
A dashboard admin fills those in with *Edit streamer* on the profile; a
handle (`@name`) or a full link both work, and only http(s) links are kept
(`lib/streamer-links.ts`). An account linked to a streamer's and counted
with it shows the same header. The "Streamers" tab of `/admin` lists the
marked accounts and their channels and unmarks them. Migration
`0018_streamers.sql` adds `players.is_streamer` and the `streamer_profiles`
table (`lib/streamers.ts`); unmarking keeps the profile row, so marking the
player again restores their channels.

## Contact form

`/contact` (linked in the sidebar, open to everyone) takes a name, email,
optional Telegram and Discord usernames and a message, and a server action
sends it to one Telegram chat with the bot in `CONTACT_TELEGRAM_BOT_TOKEN`
and `CONTACT_TELEGRAM_CHAT_ID`, in the forum topic `CONTACT_TELEGRAM_THREAD_ID`
when set (`lib/contact.ts`). Spam is kept out three
ways: a Cloudflare Turnstile widget whose token the server verifies with
Cloudflare (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; without the secret
the check is skipped in development and every submission is refused in
production), a hidden honeypot field that only bots fill in (those get a
fake success), and at most three well-formed submissions per IP per 15
minutes, read from Cloudflare's `CF-Connecting-IP`. The limit is kept in
memory, so it is per process and resets on deploy.

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
