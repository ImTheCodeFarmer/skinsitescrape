/**
 * Shapes observed on wss://api.csgogem.com/ (raw websocket, frames are
 * `[id, event, data]`), captured 2026-09-15. Money is integer cents of the
 * site's coin; `app.onFxRateUpdate` gives the coin's USD price (0.60).
 */

export type GemUser = {
  userID: string;
  username?: string;
  /** Cloudflare Images id, or a full URL for the house bots. */
  avatar?: string | null;
  xp?: number;
  role?: string | null;
};

export type GemFxRates = Record<string, { rate: number; symbol: string; name: string; lastUpdated: number }>;

// ---------------------------------------------------------------- battles

/** One slot in a battle. House bots are `userID: "bot-N"` with `wagerID: 0`. */
export type GemBattleWager = {
  userID: string;
  wagerID: number;
  /** Cents paid for the seat; already reduced by borrowModifier. */
  amount: number;
  slot: number;
  user?: GemUser;
  /** Percent of the seat price the site lent the player ("borrow mode"). */
  borrowModifier?: number;
};

/** `battle.list` rows and `battle.onNewGame`. */
export type GemBattle = {
  battleID: number;
  gameState: "CREATED" | "COUNTDOWN" | "IN_PROGRESS" | "COMPLETED" | string;
  createdAt: number;
  creator: string;
  /** Seat price in cents. */
  amount: number;
  userCount: number;
  teamSize: number;
  /** Cents the site contributed (sponsored battles). */
  funding: number;
  level: number;
  flags: { isLightning: boolean; isTerminal: boolean; isJackpot: boolean; isCursed: boolean; isPublic: boolean; isBonus: boolean };
  /** Case ids in play order. */
  rounds: number[];
  wagers: GemBattleWager[];
  payouts?: Record<string, number>;
  jackpotWinner?: string | null;
  key?: string;
};

export type GemBattleWagerEvent = GemBattleWager & { battleID: number };

/** `battle.onGameSpin`: one round for every seat; the final one carries `payouts`. */
export type GemBattleSpin = {
  battleID: number;
  round: number;
  rolls: Record<string, { spinsAt: number; type: string; payout: number; itemID?: number; slot: number; respin?: boolean; bonus?: unknown }>;
  /** Cents won per user, present on the final spin only. */
  payouts?: Record<string, number>;
  jackpotWinner?: string | null;
  isTieBreaker?: boolean;
};

export type GemBattleEnd = { battleID: number; seed: string };

// ---------------------------------------------------------------- slide

/** Sent by `slide.wagers` (deltas) and inside `slide.round`. `multiplier` is the target, e.g. 450 = 450x. */
export type GemSlideWager = { userID?: string; user?: GemUser; multiplier: number; amount: number };

export type GemSlideRound = {
  round: number;
  createdAt: number;
  hash: string;
  gameState: "OPEN" | "LOCKING_IN" | "IN_PROGRESS" | "COMPLETED" | string;
  multipliers: number[];
  wagers?: Record<string, { wagers: { multiplier: number; amount: number }[]; wager: number; user: GemUser; wagerID: number }>;
  winningMultiplier?: number;
  isJackpot?: boolean;
  startTime?: number;
};

export type GemSlideSpin = { winningMultiplier: number; isJackpot: boolean; startTime: number; endTime: number; seed: string; isBait?: boolean };

// ---------------------------------------------------------------- roulette ("double")

export type GemColour = "red" | "green" | "black";
/** Per-user running totals for the round, keyed by userID. `roulette.wagers` replaces a user's entry. */
export type GemRouletteWagers = Record<string, { user: GemUser; red: number; green: number; black: number }>;

export type GemRouletteRound = {
  round: number;
  createdAt: number;
  hash: string;
  gameState: string;
  wagers?: GemRouletteWagers;
  winningColour?: GemColour;
  startTime?: number;
};

export type GemRouletteSpin = { winningColour: GemColour; startTime: number; endTime: number; seed: string };
