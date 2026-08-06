import type { GameResultInput, LeaderboardRow } from "./types";
import { getSupabaseClient } from "./supabase";
import {
  RANKING_WEIGHT_GUESSES,
  RANKING_WEIGHT_SPEED,
  RESULT_QUEUE_STORAGE_KEY,
  ROUND_SECONDS,
} from "./constants";

/**
 * createParticipant / submitResult / fetchLeaderboard (Issue #12, #40).
 *
 * Per CLAUDE.md's seam table, this file owns the game → data contract; lib/supabase.ts is client
 * factory only. The offline retry queue lives here for the same reason — it needs submitResult's
 * payload shape and localStorage helpers, and CLAUDE.md is explicit that lib/supabase.ts has "no
 * data access."
 *
 * Writes go directly from client components with the anon key — no API route as a proxy. See
 * docs/02-architecture.md § 7.
 */

const LOCAL_LEADERBOARD_KEY = "doodlebot.local-leaderboard";
const LOCAL_PARTICIPANTS_KEY = "doodlebot.local-participants";

interface LocalResult {
  participantId: string;
  word: string;
  correct: boolean;
  timeTakenSeconds: number | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// createParticipant
// ---------------------------------------------------------------------------

/** Payload for participants INSERT. Only `name` is supplied by the client. */
interface ParticipantInsert {
  name: string;
}

/**
 * Inserts a new participant and returns their id.
 *
 * Gameplay is fully client-side (CLAUDE.md), so a rejected or unreachable insert falls through
 * to a locally-generated UUID rather than throwing — a player must be able to start a round
 * offline. The two failure branches are logged separately (rather than the previous single
 * catch-all) because they have different downstream consequences: a local-UUID participant has
 * no matching `participants` row, so every later `submitResult` for this session will fail the
 * `game_results.participant_id` foreign key and be classified `db-error` — dropped, not queued
 * (see submitResult below). That is a known, accepted gap for the fully-offline case; see #12.
 */
export async function createParticipant(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name cannot be empty");
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("participants")
      .insert([{ name: trimmed } satisfies ParticipantInsert])
      .select("id")
      .single();

    if (!error && data?.id) {
      storeLocalParticipant(data.id, trimmed);
      return data.id;
    }

    if (error) {
      console.warn(
        "createParticipant: Supabase insert rejected, using local id instead:",
        error.message,
      );
    }
  } catch (err) {
    console.warn("createParticipant: Supabase unreachable, using local id instead:", err);
  }

  const localId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  storeLocalParticipant(localId, trimmed);
  return localId;
}

function storeLocalParticipant(id: string, name: string) {
  if (typeof window === "undefined") return;
  try {
    const existing: Record<string, string> = JSON.parse(
      localStorage.getItem(LOCAL_PARTICIPANTS_KEY) || "{}",
    );
    existing[id] = name;
    localStorage.setItem(LOCAL_PARTICIPANTS_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error("Failed to write participant to localStorage", e);
  }
}

// ---------------------------------------------------------------------------
// submitResult + offline retry queue (Issue #12)
//
// The queue mechanics (dedup, re-entrancy guard, write-back-after-await) are unchanged from
// their original lib/supabase.ts implementation — that version was correct, just unreachable:
// nothing imported it, so the live submit path silently dropped failed inserts instead of
// queuing them. Moved here so it is on the path every caller actually uses, and reworked to
// carry GameResultInput (camelCase) end to end, converting to the DB's snake_case shape only at
// the insert boundary — see docs/02-architecture.md's D → E contract in lib/types.ts.
// ---------------------------------------------------------------------------

/** Payload shape at the insert boundary — matches the game_results columns exactly. */
interface GameResultInsert {
  participant_id: string;
  word: string;
  correct: boolean;
  /** Seconds taken; null when incorrect. DB CHECK constraint time_present_iff_correct enforces the pairing. */
  time_taken_seconds: number | null;
}

function toInsertPayload(result: GameResultInput): GameResultInsert {
  return {
    participant_id: result.participantId,
    word: result.word,
    correct: result.correct,
    time_taken_seconds: result.timeTakenSeconds,
  };
}

/**
 * An item held in the localStorage offline queue.
 *
 * `queueId` is a client-generated UUID attached at enqueue time. It is the deduplication key and
 * is never sent to the database. Storing it means a flush that is interrupted and replayed
 * cannot submit the same logical round twice, even if the same item was somehow pushed more than
 * once.
 */
interface QueuedResult {
  /** Client-side dedup key only — stripped before any DB INSERT. */
  queueId: string;
  result: GameResultInput;
}

/**
 * Submits a game result, with local mirroring and offline retry.
 *
 * Behaviour matrix:
 *
 *   Network OK, DB accepts row    → local write + insert succeeds → flush any backlog → return
 *   Network OK, DB rejects row    → local write; log the error; do NOT queue; return silently
 *   Network unreachable (offline) → local write; silently enqueue to localStorage; return
 *
 * This function NEVER throws. The caller is the result screen — throwing would interrupt
 * gameplay just as badly as a network failure would, violating the core requirement:
 *   "A volunteer should never have to tell someone their game didn't count."
 * See docs/02-architecture.md § 7.
 *
 * The local write happens first and unconditionally — it is the device-local leaderboard mirror
 * computeLocalLeaderboard() reads, independent of whether the remote insert or queue succeeds.
 *
 * No sketch data can appear in the payload — GameResultInput has no field for it.
 */
export async function submitResult(result: GameResultInput): Promise<void> {
  saveLocalResult(result);

  const outcome = await attemptInsert(result);

  if (outcome === "success") {
    // A live submission just went through — take the opportunity to drain any backlog.
    await flushQueue();
    return;
  }

  if (outcome === "network-error") {
    // Offline or unreachable — queue silently. The player already sees a normal result screen.
    enqueue(result);
    return;
  }

  // outcome === "db-error": already logged inside attemptInsert. Not queued — retrying the same
  // payload against the same DB constraints would reproduce the same rejection. The most common
  // cause is a participant created under createParticipant's local-UUID fallback, whose id has
  // no matching participants row and so fails the participant_id foreign key every time.
}

function saveLocalResult(result: GameResultInput) {
  if (typeof window === "undefined") return;
  try {
    const results: LocalResult[] = JSON.parse(localStorage.getItem(LOCAL_LEADERBOARD_KEY) || "[]");
    results.push({
      ...result,
      timestamp: Date.now(),
    });
    localStorage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(results));
  } catch (e) {
    console.error("Failed to write result to localStorage", e);
  }
}

/** What a single insert attempt can produce. */
type InsertOutcome = "success" | "network-error" | "db-error";

/**
 * Issues a single INSERT into game_results and classifies the outcome.
 *
 * Key detail from reading @supabase/postgrest-js source (PostgrestBuilder.ts):
 *
 *   When `fetch` itself throws (offline, DNS failure, etc.), the builder catches it and
 *   returns a resolved promise with `{ error: {...}, status: 0, statusText: '' }`.
 *   It does NOT re-throw in non-throwOnError mode (the default).
 *
 *   Therefore:
 *     - This function never needs a try/catch — the Supabase client always resolves.
 *     - `status === 0` reliably signals a network/fetch failure (not an HTTP response).
 *     - `status >= 400` signals a real HTTP error from PostgREST or the DB.
 *     - The `error` field on the response is a plain object `{ message, details, hint, code }`,
 *       NOT a PostgrestError instance. It has no `status` property of its own — `status`
 *       is a top-level field on the response, not inside `error`.
 */
async function attemptInsert(result: GameResultInput): Promise<InsertOutcome> {
  // We do not use .select() here — a bare INSERT returns 204 No Content on success, which is
  // all we need. Using .select() would require the RLS policy to also grant SELECT, which the
  // architecture explicitly disallows for anon on game_results.
  const { error, status } = await getSupabaseClient()
    .from("game_results")
    .insert(toInsertPayload(result));

  if (!error) {
    // status 201 (Created) or 204 (No Content) — row was accepted.
    return "success";
  }

  if (status === 0) {
    // status 0 means the fetch never got an HTTP response: the device is offline, the DNS
    // lookup failed, or the connection was refused. Queue and continue gameplay.
    return "network-error";
  }

  // Any non-zero status with an error object is a real HTTP error (4xx / 5xx) from PostgREST
  // or the DB. Log it for the developer; do not queue.
  console.error(`[DoodleBot] game_results INSERT rejected (HTTP ${status}):`, error);
  return "db-error";
}

// ---------------------------------------------------------------------------
// localStorage queue — read / write
// ---------------------------------------------------------------------------

/**
 * Reads the offline queue from localStorage.
 * Returns an empty array if the key is absent, empty, or contains malformed JSON.
 * SSR-safe: returns [] immediately when `window` is not defined.
 */
function readQueue(): QueuedResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RESULT_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Defensive: only accept arrays so a corrupt value doesn't break flush.
    return Array.isArray(parsed) ? (parsed as QueuedResult[]) : [];
  } catch {
    // JSON.parse failure — treat as empty.
    return [];
  }
}

/** Persists the queue to localStorage. SSR-safe: no-ops when `window` is not defined. */
function writeQueue(queue: QueuedResult[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RESULT_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

// ---------------------------------------------------------------------------
// localStorage queue — enqueue / flush
// ---------------------------------------------------------------------------

/**
 * Returns a UUID v4 string without any external dependency.
 * Uses `crypto.randomUUID()` where available (all modern browsers, Node ≥ 14.17).
 * Falls back to a Math.random-based generator for environments where it is absent.
 */
function generateQueueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback — Math.random is not cryptographically strong, but the queueId is only used for
  // local deduplication, not as a security token.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Appends a result to the offline queue in localStorage.
 *
 * A fresh `queueId` is generated here and stored alongside the result. It is used only for
 * deduplication during flushQueue — it is never sent to the database.
 */
function enqueue(result: GameResultInput): void {
  const queue = readQueue();
  queue.push({ queueId: generateQueueId(), result });
  writeQueue(queue);
}

/**
 * True while a flushQueue() call is in progress.
 *
 * JavaScript is single-threaded, but `async` functions yield at every `await`, so two callers
 * can interleave: one triggered by a successful submit and one by `window.online` firing moments
 * later could both reach readQueue() before either has written back, causing the same entries to
 * be INSERTed twice.
 *
 * This flag prevents overlapping flush executions. The second caller returns immediately; the
 * already-running flush handles the full queue snapshot it captured.
 *
 * NOTE: This flag alone does not prevent a separate race between enqueue() and the final
 * writeQueue() call. That race is handled inside flushQueue() itself — see the write-back
 * comment below.
 */
let _isFlushing = false;

/**
 * Drains the offline queue, submitting each entry to the database.
 *
 * Concurrency:
 *   Only one execution runs at a time (_isFlushing guard). A second concurrent caller returns
 *   immediately and loses nothing — the in-flight flush processes the full queue.
 *
 * Idempotency / deduplication guarantee:
 *   Duplicate queueId entries are removed before any INSERT is attempted, so calling flushQueue
 *   twice in a row cannot double-count the same round.
 *
 * Retention policy:
 *   - Successfully inserted entries are removed from the persistent queue.
 *   - Entries that fail with a network error are kept for the next flush attempt.
 *   - Entries the DB rejects are dropped (retrying would reproduce the same error).
 *
 * Errors from individual inserts are handled internally and never propagate to the caller.
 */
async function flushQueue(): Promise<void> {
  if (_isFlushing) return;
  _isFlushing = true;

  try {
    const snapshot = readQueue();
    if (snapshot.length === 0) return;

    // Collect the queueIds we will attempt to submit in this pass. Deduplication within this
    // snapshot is defence-in-depth; under normal operation each queueId is unique.
    const seen = new Set<string>();
    const toProcess = snapshot.filter(({ queueId }) => {
      if (seen.has(queueId)) return false;
      seen.add(queueId);
      return true;
    });

    // Track which items from this pass still need to stay in the queue (network still down).
    const failedThisPass = new Set<string>();

    for (const item of toProcess) {
      const outcome = await attemptInsert(item.result);

      if (outcome === "network-error") {
        // Still offline — must not remove this item.
        failedThisPass.add(item.queueId);
      }
      // "success" → item is consumed; remove it.
      // "db-error" → item is dropped; retrying would reproduce the same rejection.
    }

    // -------------------------------------------------------------------------
    // Write-back: re-read localStorage NOW, after all awaits have completed.
    //
    // Why: enqueue() may have been called while the async loop above was running (e.g. the
    // player completed another round mid-flush). If we wrote `remaining` directly — a subset of
    // the snapshot we read at the start — we would silently discard those newly-added items.
    //
    // Instead we:
    //   1. Re-read the current queue (which may contain new items).
    //   2. Keep any item whose queueId was NOT in this flush's attempt set (new arrivals).
    //   3. Keep any item that WAS attempted but failed with a network error.
    //   4. Drop items that were successfully inserted or DB-rejected.
    // -------------------------------------------------------------------------
    const currentQueue = readQueue();
    const attempted = new Set<string>(toProcess.map((i) => i.queueId));

    const nextQueue = currentQueue.filter(
      ({ queueId }) =>
        // Not processed in this pass → arrived after snapshot; always keep.
        !attempted.has(queueId) ||
        // Processed but still offline → keep for the next flush.
        failedThisPass.has(queueId),
    );

    writeQueue(nextQueue);
  } finally {
    // Always release the lock, even if an unexpected error escapes the loop above.
    _isFlushing = false;
  }
}

// ---------------------------------------------------------------------------
// window.online listener — registered once at module evaluation (browser only)
// ---------------------------------------------------------------------------

/**
 * The `window.online` event triggers an automatic queue flush.
 *
 * The listener is registered exactly once, even if this module is re-evaluated during Next.js
 * Fast Refresh. A plain module-level boolean would reset on each re-evaluation, so the flag is
 * stored on `globalThis`, which persists across module reloads in the same page.
 *
 * SSR-safe: the entire block is guarded by `typeof window !== "undefined"`.
 */
const _ONLINE_LISTENER_REGISTERED_KEY = "__doodlebot_online_flush_registered__";

if (
  typeof window !== "undefined" &&
  !(globalThis as Record<string, unknown>)[_ONLINE_LISTENER_REGISTERED_KEY]
) {
  window.addEventListener("online", () => {
    // Fire-and-forget. flushQueue handles all errors internally.
    flushQueue().catch(() => {
      /* intentionally swallowed — gameplay must never see this */
    });
  });

  (globalThis as Record<string, unknown>)[_ONLINE_LISTENER_REGISTERED_KEY] = true;
}

// ---------------------------------------------------------------------------
// fetchLeaderboard (Issue #40)
// ---------------------------------------------------------------------------

/**
 * A row exactly as `leaderboard_view` returns it.
 *
 * The view is snake_case and has no `rank` column, so it does NOT match LeaderboardRow.
 * Casting the response straight to LeaderboardRow compiles fine and fails silently at runtime —
 * every renamed field lands as `undefined`. Map it explicitly instead.
 *
 * Postgres `numeric` may serialise as a JSON string rather than a number depending on the
 * column type in the view, so the numeric fields are coerced rather than trusted.
 */
interface LeaderboardViewRow {
  participant_id: string;
  name: string;
  score: number | string;
  successful_guesses: number | string;
  total_games: number | string;
  best_time_seconds: number | string | null;
}

function toNumber(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Narrows an unknown row to LeaderboardViewRow rather than trusting an `as` cast.
 *
 * Deliberately not a full shape validator — the numeric fields are coerced by toNumber /
 * toNullableNumber regardless of what arrives, so this only needs to catch "the view shape
 * changed entirely" (participant_id renamed, view swapped, PostgREST returned something odd),
 * not every possible drift. participant_id is the one field that can't be defaulted: it's the
 * React list key and what the result screen matches "my rank" against.
 */
function isLeaderboardViewRow(row: unknown): row is LeaderboardViewRow {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as Record<string, unknown>).participant_id === "string" &&
    typeof (row as Record<string, unknown>).name === "string"
  );
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const supabase = getSupabaseClient();
    // Explicit column list rather than `*`: if the view is ever reshaped this fails loudly
    // with a 400 instead of silently returning rows full of undefined fields.
    const { data, error } = await supabase
      .from("leaderboard_view")
      .select("participant_id, name, score, successful_guesses, total_games, best_time_seconds");

    if (error) {
      // Logged, not swallowed — a silent fallback to local data is what hid the shape
      // mismatch here in the first place.
      console.warn("leaderboard_view query failed, using local leaderboard:", error.message);
    } else if (data && data.length > 0) {
      const validRows = data.filter(isLeaderboardViewRow);
      if (validRows.length < data.length) {
        // Not thrown — one malformed row shouldn't take down the whole board — but loud,
        // because this means the view's shape drifted from what this file expects.
        console.warn(
          `leaderboard_view: dropped ${data.length - validRows.length} row(s) missing participant_id/name. View shape may have changed — see docs/02-architecture.md § 7.`,
        );
      }
      const rows = validRows.map((row) => ({
        participantId: row.participant_id,
        name: row.name,
        score: toNumber(row.score),
        successfulGuesses: toNumber(row.successful_guesses),
        gamesPlayed: toNumber(row.total_games),
        bestTimeSeconds: toNullableNumber(row.best_time_seconds),
      }));
      // The view has no rank column and a bare select has no ordering guarantee, so rank is
      // assigned here using the same comparator as the offline path.
      return sortAndRank(rows);
    }
  } catch (err) {
    console.warn("Supabase unreachable, using local leaderboard:", err);
  }

  return computeLocalLeaderboard();
}

/** A leaderboard row before rank has been assigned. */
type UnrankedRow = Omit<LeaderboardRow, "rank">;

/** Score desc, then successful guesses desc, then fastest correct round asc. */
function compareRows(a: UnrankedRow, b: UnrankedRow): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.successfulGuesses !== a.successfulGuesses) {
    return b.successfulGuesses - a.successfulGuesses;
  }
  if (a.bestTimeSeconds !== null && b.bestTimeSeconds !== null) {
    return a.bestTimeSeconds - b.bestTimeSeconds;
  }
  return 0;
}

/**
 * Sorts and assigns 1-based rank. Shared by the remote and offline paths so the stall display
 * orders identically whether or not the network is up.
 */
function sortAndRank(rows: UnrankedRow[]): LeaderboardRow[] {
  return [...rows]
    .sort(compareRows)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
}

export function computeLocalLeaderboard(): LeaderboardRow[] {
  if (typeof window === "undefined") return [];
  try {
    const participants: Record<string, string> = JSON.parse(localStorage.getItem(LOCAL_PARTICIPANTS_KEY) || "{}");
    const results: LocalResult[] = JSON.parse(localStorage.getItem(LOCAL_LEADERBOARD_KEY) || "[]");

    const statsMap: Record<
      string,
      {
        name: string;
        successfulGuesses: number;
        gamesPlayed: number;
        speedBonus: number;
        bestTimeSeconds: number | null;
      }
    > = {};

    for (const r of results) {
      const pName = participants[r.participantId] || "Anonymous";
      if (!statsMap[r.participantId]) {
        statsMap[r.participantId] = {
          name: pName,
          successfulGuesses: 0,
          gamesPlayed: 0,
          speedBonus: 0,
          bestTimeSeconds: null,
        };
      }

      const player = statsMap[r.participantId];
      player.gamesPlayed += 1;

      if (r.correct && r.timeTakenSeconds !== null) {
        player.successfulGuesses += 1;
        const bonus = Math.max(0, ROUND_SECONDS - r.timeTakenSeconds);
        player.speedBonus += bonus;

        if (player.bestTimeSeconds === null || r.timeTakenSeconds < player.bestTimeSeconds) {
          player.bestTimeSeconds = r.timeTakenSeconds;
        }
      }
    }

    const rows: UnrankedRow[] = Object.entries(statsMap).map(([pId, data]) => ({
      participantId: pId,
      name: data.name,
      score: Math.round(
        data.successfulGuesses * RANKING_WEIGHT_GUESSES + data.speedBonus * RANKING_WEIGHT_SPEED
      ),
      successfulGuesses: data.successfulGuesses,
      gamesPlayed: data.gamesPlayed,
      bestTimeSeconds:
        data.bestTimeSeconds !== null ? Number(data.bestTimeSeconds.toFixed(1)) : null,
    }));

    return sortAndRank(rows);
  } catch (e) {
    console.error("Failed to compute local leaderboard", e);
    return [];
  }
}
