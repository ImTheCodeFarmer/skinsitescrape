/**
 * Shapes on wss://api.rusteasy.com/socket.io/ (Socket.IO, `userStatus=guest`),
 * captured 2026-09-16, with the site's client code and public API
 * (`/myapi/...`) filling in what did not run while we listened. Money is
 * USD with decimals ("gems", 1:1). Several payloads arrive as JSON *strings*;
 * `parse()` in site.ts unwraps them.
 *
 * Players are Steam ids. The house bot is "Tunnel Dweller" with steamid64
 * "0"; battle bots are the string "bot" in a seat.
 */

// ---------------------------------------------------------------- case battles

export type ReSeat = { steamid64: string; username?: string; avatar?: string; level?: number } | "bot" | null;

/** `newCaseBattle` (sent on creation, then again when it starts, players filled in). */
export type ReBattle = {
  id?: number;
  url_key: string;
  /** 1 open, 4 starting, 2 running, 3 finished. */
  status: number;
  /** 1 1v1, 2 1v1v1, 3 1v1v1v1, 4 2v2, 5 3v3, 6 1v1v1v1v1v1. */
  mode: number;
  cursed: number | boolean;
  shared: number | boolean;
  jackpot: number | boolean;
  terminal: number | boolean;
  wildcard: number | boolean;
  rapid: number | boolean;
  private: number | boolean;
  /** Creator lends this percent of every real seat's price. */
  borrow: number | boolean;
  borrow_percent: number;
  /** Creator funds this percent of the other seats. */
  funding: number | boolean;
  percent: number;
  case_count: number;
  /** Price of a seat, USD. */
  total_value: number;
  unboxed_amount?: number;
  created_at?: string;
  creator: { steamid64: string; username?: string; avatar?: string; level?: number };
  player2?: ReSeat;
  player3?: ReSeat;
  player4?: ReSeat;
  player5?: ReSeat;
  player6?: ReSeat;
  /** JSON string: bot logo file names, by seat after the creator. */
  logo?: string | string[];
  winner?: string | null;
};

export type ReBattleDrop = { position: number; round: number; price: number; name?: string; item_id?: number; respin?: number };

/** `battles:round`: one drop per seat; `unboxed_amount` is the battle's running total (wild cards can lower it). */
export type ReBattleRound = { battleId: string; roundNo: number; caseId?: number; drops: ReBattleDrop[]; unboxed_amount?: number };

/** `battles:finished`. `winner` is "teamN" in team modes, otherwise the winning seat ("playerN", "N", or "team" of size 1). */
export type ReBattleFinished = { battleId: string; finalStatus: number; winner?: string | number | null };

/**
 * `caseBattleWinner`, sent in the battle's own room ("battle-<key>"). The
 * page derives each seat's prize from `winnerPrize`: `winnings` for the
 * winning seat, `winnings / teamSize` per seat in team mode, `winnings` for
 * everyone in shared mode. Field names beyond that are from the client;
 * the raw row is kept for checking.
 */
export type ReBattleWinner = {
  battleId?: string;
  gameId?: string;
  url_key?: string;
  winnerPrize: { mode: "team" | "shared" | string; winnings: number; winning_team?: string; winner_position?: number | string };
  positionWinnings?: Record<string, unknown>;
  jackpot?: boolean;
  isTieBreaker?: boolean;
};

// ---------------------------------------------------------------- coinflip

/** `newCoinflipGame`. `side` is "ct" or "t". */
export type ReCoinflipNew = {
  coinflip_id: number;
  amount: number | string;
  side: string;
  user_steamid64: string;
  user_username?: string;
  user_avatar?: string;
  created_at?: string;
};

/** `coinflipGameUpdate`. status 2 joined, 3 rolling, 4 finished, 5 cancelled, 1 back to open. */
export type ReCoinflipUpdate = {
  game_id: number;
  status: number;
  side?: string;
  user_steamid64?: string;
  username?: string;
  avatar?: string;
  second_amount?: number | string;
  amount?: number | string;
  winner_side?: string;
  losing_side?: string;
  winner_username?: string;
  winner_avatar?: string;
  winTicket?: number;
  finish_date?: string;
  fee?: number;
};

// ---------------------------------------------------------------- jackpot

export type ReJackpotUser = { id?: number; username?: string; avatar?: string; steamid64: string };
export type ReJackpotBet = { id: number; user_id: number; game_id: number; price: number; from?: number; to?: number; user: ReJackpotUser };

/** `newDeposit` (JSON string). */
export type ReJackpotDeposit = { gameId: number; gameStatus: number; gamePrice: number; bets: ReJackpotBet[] };

/** `slider`: the draw. `users` are per-player totals with chance; `winner` is one of them. */
export type ReJackpotSlider = {
  time: number;
  winner: ReJackpotUser & { chance?: number; totalPrice?: number };
  bets: ReJackpotBet[];
  users: (ReJackpotUser & { chance?: number; totalPrice?: number })[];
};

// ---------------------------------------------------------------- double

/** `roullete_bet` (JSON string). `doubledip` means the amount replaces the player's earlier bet on that colour. */
export type ReDoubleBet = { steamid64: string; username?: string; avatar?: string; level?: number; amount: number; color: "red" | "black" | "gold" | "bait" | string; doubledip?: boolean };

/** `roullete_slider`: result 0..14. 0 gold, 1 and 14 bait, even red, odd black. */
export type ReDoubleSpin = { result: number; time?: number; redTotal?: number; blackTotal?: number; goldTotal?: number; baitTotal?: number };

// ---------------------------------------------------------------- champion

/** `challengerInfo`: a fight starts. */
export type ReChallenger = {
  champion_steamid64: string;
  champion_username?: string;
  champion_avatar?: string;
  champion_total: number;
  opponent_steamid64: string;
  opponent_username?: string;
  opponent_avatar?: string;
  opponent_total: number;
};

/** `newChampionInfo`: the stack after a fight, held by whoever won. */
export type ReChampionInfo = { champion_steamid64: string; champion_username?: string; champion_avatar?: string; total: number };

/** `champion` (JSON string): someone took the empty throne. */
export type ReChampionSeat = { steamid64: string; username?: string; avatar?: string; total: number };
