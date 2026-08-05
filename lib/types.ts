/**
 * Types that cross a stream boundary.
 *
 * Anything one stream defines and another consumes lives here, so the seams between canvas,
 * inference, game shell and data can be read in one file instead of three. Types internal to a
 * single module stay in that module.
 *
 * Changing anything in this file is a cross-team change. Say so before you do it.
 */

/**
 * CONTRACT — canvas (C) → inference (B)
 *
 * The drawing canvas exposes this through a ref. D mounts the component and holds the ref;
 * B calls these to get pixels. Neither side imports the other's internals, which is what lets
 * the canvas and the model be built at the same time.
 */
export interface CanvasHandle {
  /** The live canvas element, as the source for preprocessing. Treat as read-only. */
  getSnapshot(): HTMLCanvasElement;
  /**
   * True if strokes changed since the last call, and resets the flag.
   *
   * This is what implements "sample only when strokes changed" — an idle canvas must cost
   * nothing, so the sampling loop calls this first and skips inference when it returns false.
   */
  consumeDirty(): boolean;
  /** Wipes all strokes. */
  clear(): void;
}

/**
 * CONTRACT — inference (B) → game (D)
 *
 * Carries the two-sample win rule across samples. D holds this as state and feeds the previous
 * value back into evaluateGuess() on each sample. See lib/guess.ts.
 */
export interface GuessState {
  /** Display label of the current top guess, or null before the first prediction lands. */
  topGuess: string | null;
  /** Consecutive samples the target has held top-1 at or above CONFIDENCE_THRESHOLD. */
  streak: number;
  /**
   * True once streak reaches REQUIRED_CONSECUTIVE_SAMPLES. Terminal — once won, it never
   * returns to false, so D can drive the round-end transition off this alone.
   */
  won: boolean;
}

/**
 * CONTRACT — game (D) → data (E)
 *
 * Camel-case on purpose: this is the shape D produces, and E maps it to the snake_case column
 * names in GameResultInsert. D should never need to know the database's naming.
 */
export interface GameResultInput {
  participantId: string;
  word: string;
  correct: boolean;
  /** Seconds taken to win, or null when the round timed out. */
  timeTakenSeconds: number | null;
}

/** One row of the aggregate leaderboard view. */
export interface LeaderboardRow {
  rank: number;
  participantId: string;
  name: string;
  /** (successfulGuesses × W_A) + (speedBonus × W_B), computed in SQL by the view. */
  score: number;
  successfulGuesses: number;
  gamesPlayed: number;
  /** Fastest correct round, or null if they have not won one yet. */
  bestTimeSeconds: number | null;
}

/**
 * Re-exported for convenience. Prediction and Word are colocated with the modules that own
 * them, but they cross boundaries too — importing them from here is equivalent.
 *
 * These are type-only re-exports, so pulling them in does not drag lib/model.ts (and with it
 * TF.js, once installed) into a consumer's bundle.
 */
export type { Prediction } from "./model";
export type { Word, Difficulty } from "./word-bank";
