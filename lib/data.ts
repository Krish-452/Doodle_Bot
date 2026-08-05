import type { GameResultInput, LeaderboardRow } from "./types";

/**
 * Everything the app reads from or writes to Supabase.
 *
 * Kept separate from lib/supabase.ts, which stays a bare client factory: the game stream calls
 * these three functions and never touches the client, the table names, or the column casing.
 * That is what lets the data stream change the schema — or put a queue in front of it — without
 * anyone else editing a file.
 *
 * All three run from client components with the anon key. There is no API route handler in
 * front of them; it would add a hop for no benefit and break the offline queue.
 * See docs/02-architecture.md § 7.
 */

/**
 * Creates the participant row and returns its id, which the caller puts in sessionStorage.
 *
 * Rejects on failure — unlike submitResult() there is nothing useful to queue, because the
 * player cannot start a round without an id. The caller should surface a retry.
 */
export async function createParticipant(name: string): Promise<string> {
  throw new Error(`lib/data.ts: createParticipant() not implemented (name "${name}")`);
}

/**
 * Records a finished round.
 *
 * **Resolves once the result is durably handed off — either written to Supabase or written to
 * the local retry queue.** It does not reject on network failure, and callers should not add
 * their own retry: the queue drains on the next successful submit and on `window.online`.
 * Gameplay is fully offline-capable and only this sync needs the network, so a volunteer
 * should never have to tell someone their game did not count.
 *
 * Rejects only on programmer error — missing env vars, malformed input.
 */
export async function submitResult(result: GameResultInput): Promise<void> {
  throw new Error(
    `lib/data.ts: submitResult() not implemented (word "${result.word}", correct ${result.correct})`,
  );
}

/**
 * Reads the aggregate leaderboard view — one query, not five.
 *
 * Called server-side for the leaderboard's first paint, and again client-side on each Realtime
 * insert. Realtime fires on tables rather than views, so the subscription watches game_results
 * and calls this to re-read.
 */
export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  throw new Error("lib/data.ts: fetchLeaderboard() not implemented");
}
