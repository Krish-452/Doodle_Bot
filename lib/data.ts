import type { GameResultInput, LeaderboardRow, LeaderboardSnapshot } from "./types";
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

/** Payload for participants INSERT. The client generates `id` — see createParticipant below. */
interface ParticipantInsert {
  id: string;
  name: string;
}

/**
 * Inserts a new participant and returns their id.
 *
 * The id is generated client-side with generateUuid() and sent explicitly in the INSERT, rather
 * than reading it back with `.select().single()` (i.e. `RETURNING id`). Postgres evaluates a
 * RETURNING clause under the table's SELECT policies, not its INSERT policies — and
 * supabase/schema.sql (#4) deliberately grants anon no SELECT on `participants`. Chaining
 * `.select()` here would make every insert fail even with the schema applied correctly.
 *
 * Gameplay is fully client-side (CLAUDE.md), so a rejected or unreachable insert falls through
 * to the local id rather than throwing — a player must be able to start a round offline.
 * Generating the id up front (instead of only on failure) means the id is identical whichever
 * path is taken: if the row insert fails now but a later submitResult retry or queue flush
 * creates it via the FK-recovery path in attemptInsert, it lands under the same id the session
 * has been using all along, instead of orphaning it under a second, never-persisted UUID.
 */
export async function createParticipant(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name cannot be empty");
  }

  const id = generateUuid();
  storeLocalParticipant(id, trimmed);

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("participants")
      .insert([{ id, name: trimmed } satisfies ParticipantInsert]);

    if (error) {
      console.warn(
        "createParticipant: Supabase insert rejected, using local id instead:",
        error.message,
      );
    }
  } catch (err) {
    console.warn("createParticipant: Supabase unreachable, using local id instead:", err);
  }

  return id;
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
  const isCorrect = Boolean(result.correct);
  let timeTaken: number | null = null;
  if (isCorrect) {
    if (
      typeof result.timeTakenSeconds === "number" &&
      !isNaN(result.timeTakenSeconds) &&
      result.timeTakenSeconds > 0
    ) {
      timeTaken = Number(result.timeTakenSeconds.toFixed(2));
    } else {
      timeTaken = 0.5;
    }
  }
  return {
    participant_id: result.participantId,
    word: result.word,
    correct: isCorrect,
    time_taken_seconds: timeTaken,
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
function getStoredParticipantName(participantId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing: Record<string, string> = JSON.parse(
      localStorage.getItem(LOCAL_PARTICIPANTS_KEY) || "{}"
    );
    return existing[participantId] || null;
  } catch {
    return null;
  }
}

async function attemptInsert(result: GameResultInput): Promise<InsertOutcome> {
  const payload = toInsertPayload(result);
  const supabase = getSupabaseClient();

  const { error, status } = await supabase
    .from("game_results")
    .insert(payload);

  if (!error) {
    return "success";
  }

  if (status === 0) {
    return "network-error";
  }

  // Handle a missing participant row (HTTP 409, or Postgres FK violation 23503). A plain 400 is
  // excluded on purpose — the most common 400 here is the time_present_iff_correct CHECK, which
  // creating a participant row cannot fix, so retrying would just reproduce the same rejection.
  if (status === 409 || (error && error.code === "23503")) {
    try {
      const name = getStoredParticipantName(result.participantId) || "Player";
      // Plain insert, not upsert: an upsert's ON CONFLICT DO UPDATE path needs an UPDATE policy
      // that anon does not have (see supabase/schema.sql — insert-only). This id has no row yet
      // by construction (we're only here because the FK just failed), so insert is sufficient
      // and doesn't require a policy #4 deliberately withholds.
      const { error: pErr } = await supabase
        .from("participants")
        .insert([{ id: result.participantId, name }]);

      if (!pErr) {
        const { error: retryErr } = await supabase
          .from("game_results")
          .insert(payload);

        if (!retryErr) {
          return "success";
        }
      }
    } catch {
      // ignore retry errors
    }
  }

  console.warn(`[DoodleBot] game_results INSERT rejected (HTTP ${status}):`, error?.message || error);
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
 *
 * Shared by createParticipant (the participant id, sent to the DB) and enqueue (the queueId,
 * local-only). Neither use is a security token — the Math.random fallback path is fine for both.
 */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
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
  queue.push({ queueId: generateUuid(), result });
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

/**
 * Fetches the aggregate leaderboard, reporting whether it actually came from Supabase.
 *
 * The `source` field (Issue #14) exists because a remote read that returns zero rows and a
 * remote read that *fails* both used to render identically — an empty board. At a stall, that's
 * the worst available failure mode: a misconfigured or unreachable project looks exactly like a
 * healthy one with no plays yet, and nobody watching it can tell. `source: "local"` plus `error`
 * lets the caller (LeaderboardClient) show a status pill and a distinct empty state instead of
 * silently reusing computeLocalLeaderboard()'s shape for both cases.
 */
export async function fetchLeaderboard(): Promise<LeaderboardSnapshot> {
  const local = (error: string): LeaderboardSnapshot => ({
    rows: computeLocalLeaderboard(),
    source: "local",
    error,
  });

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
      return local(error.message);
    }

    if (!data) {
      // No error, but no data either — PostgREST shouldn't produce this on a successful select,
      // but fall back rather than trust an absent response.
      console.warn("leaderboard_view query returned no data and no error — using local leaderboard.");
      return local("leaderboard_view returned no data");
    }

    // Trust a successful query regardless of row count (Issue #14). Previously this required
    // `data.length > 0`, so a genuinely empty remote board fell through to
    // computeLocalLeaderboard() with no way to tell it apart from a failure. A real zero-row
    // response now reports source: "remote" and the actual empty state renders.
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
    return { rows: sortAndRank(rows), source: "remote", error: null };
  } catch (err) {
    console.warn("Supabase unreachable, using local leaderboard:", err);
    return local(err instanceof Error ? err.message : String(err));
  }
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
