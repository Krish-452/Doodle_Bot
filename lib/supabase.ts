import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RESULT_QUEUE_STORAGE_KEY } from "./constants";

/**
 * Supabase client factory and data-layer helpers (Issue #12).
 *
 * Architecture constraints honoured here:
 *   - Writes go directly from client components with the anon key.
 *     No API route handler as a proxy — it adds a hop for no benefit and breaks the
 *     offline queue. See docs/02-architecture.md § 7.
 *   - The anon key is public and ships in the bundle. RLS is the actual security boundary:
 *     anon may INSERT into both tables and SELECT only from the aggregate leaderboard view.
 *     See docs/02-architecture.md § 6.
 *   - Sketch data never leaves the device. The GameResultInsert type enforces this by
 *     construction — it contains only the four documented schema columns.
 *     See docs/02-architecture.md note after § 6 schema block.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Payload for participants INSERT.
 * Maps exactly to the documented schema: id (server-generated), name, created_at (server-default).
 * Only `name` is supplied by the client.
 */
export interface ParticipantInsert {
  name: string;
}

/**
 * Payload for game_results INSERT.
 *
 * Columns match the documented schema exactly (docs/02-architecture.md § 6).
 * Sketch / canvas / image data is absent from this type by construction — there is no field
 * for it, so it cannot accidentally appear in any network payload.
 *
 * The DB CHECK constraint `time_present_iff_correct` enforces:
 *   correct=true  → time_taken_seconds must be non-null
 *   correct=false → time_taken_seconds must be null
 * Validate this before calling submitResult to avoid a DB rejection.
 */
export interface GameResultInsert {
  participant_id: string;
  word: string;
  correct: boolean;
  /** Seconds taken; null when incorrect. DB CHECK constraint enforces the pairing. */
  time_taken_seconds: number | null;
}

/**
 * An item held in the localStorage offline queue.
 *
 * `queueId` is a client-generated UUID attached at enqueue time. It is the deduplication key
 * and is NEVER sent to the database — it is stripped before the INSERT is issued.
 * Storing it in the queue means a flush that is interrupted and replayed cannot submit the same
 * logical round twice, even if the same item was somehow pushed more than once.
 */
interface QueuedResult {
  /** Client-side dedup key only — stripped before any DB INSERT. */
  queueId: string;
  result: GameResultInsert;
}

// leaderboard_view is now defined in supabase/schema.sql (Issue #4) and documented in
// docs/02-architecture.md § 7. Its row type (`LeaderboardViewRow`) lives in lib/data.ts, next to
// the only code that reads it (Issue #40).

// ---------------------------------------------------------------------------
// Singleton Supabase client
// ---------------------------------------------------------------------------

let _client: SupabaseClient | null = null;

/**
 * Returns the module-level Supabase client, creating it on first call.
 *
 * Uses the public anon key (NEXT_PUBLIC_*) so the client is safe to instantiate in browser
 * components. The service_role key must never appear in a NEXT_PUBLIC_ variable.
 *
 * Throws at call-time if the env vars are absent, so the error surfaces early during
 * development rather than silently at runtime inside a component.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing. " +
        "Copy .env.example → .env.local and set NEXT_PUBLIC_SUPABASE_URL " +
        "and NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "The anon key is public by design; never use the service_role key here.",
    );
  }

  _client = createClient(url, anonKey);
  return _client;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inserts a new participant and returns the server-generated UUID.
 *
 * This is a pre-game gate: if it fails the player cannot start, so we throw rather than queue.
 * The caller (the name-entry form) is responsible for showing the error and letting the user
 * retry.
 *
 * TODO: Supabase project not yet provisioned. Confirm RLS policy:
 *   anon may INSERT into participants, may NOT SELECT. (docs/02-architecture.md § 6)
 */
export async function createParticipant(name: string): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .from("participants")
    .insert({ name } satisfies ParticipantInsert)
    .select("id")
    .single();

  if (error) {
    // error here is the plain { message, details, hint, code } object from PostgREST,
    // not a PostgrestError instance. We surface the message to the caller.
    throw new Error(`createParticipant failed: ${error.message}`);
  }

  // The query used .single(), so data is the inserted row. The id column is
  // `uuid primary key default gen_random_uuid()` — always present on a successful insert.
  return (data as { id: string }).id;
}

/**
 * Attempts to insert a game result into `game_results`, with offline fallback.
 *
 * Behaviour matrix:
 *
 *   Network OK, DB accepts row   → insert succeeds → flush the offline queue → return
 *   Network OK, DB rejects row   → log the error, do NOT queue, return silently
 *   Network unreachable (offline) → silently enqueue to localStorage → return
 *
 * This function NEVER throws. The caller is the result screen — throwing would interrupt
 * gameplay just as badly as a network failure would, violating the core requirement:
 *   "A volunteer should never have to tell someone their game didn't count."
 * See docs/02-architecture.md § 7.
 *
 * db-errors are not queued because retrying the same payload against the same DB constraints
 * would produce the same rejection indefinitely. They are logged to the console so a developer
 * watching DevTools can diagnose schema/RLS mismatches during development and event setup.
 *
 * No sketch data can appear in the payload — GameResultInsert has no field for it.
 *
 * TODO: Confirm RLS policy: anon may INSERT into game_results, may NOT SELECT raw rows.
 *   (docs/02-architecture.md § 6)
 */
export async function submitResult(result: GameResultInsert): Promise<void> {
  const outcome = await attemptInsert(result);

  if (outcome === "success") {
    // A live submission just went through — take the opportunity to drain any backlog.
    await flushQueue();
    return;
  }

  if (outcome === "network-error") {
    // Offline or unreachable — queue silently. The player sees a normal result screen.
    enqueue(result);
    return;
  }

  // outcome === "db-error": already logged inside attemptInsert. Do not queue (retrying would
  // produce the same DB rejection), do not throw (that would break the result screen).
  // The round result is lost for leaderboard purposes but the player's experience is intact.
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
async function attemptInsert(result: GameResultInsert): Promise<InsertOutcome> {
  // We do not use .select() here — a bare INSERT returns 204 No Content on success,
  // which is all we need. Using .select() would require the RLS policy to also grant SELECT,
  // which the architecture explicitly disallows for anon on game_results.
  const { error, status } = await getSupabaseClient()
    .from("game_results")
    .insert(result satisfies GameResultInsert);

  if (!error) {
    // status 201 (Created) or 204 (No Content) — row was accepted.
    return "success";
  }

  if (status === 0) {
    // status 0 means the fetch never got an HTTP response: the device is offline, the
    // DNS lookup failed, or the connection was refused. Queue and continue gameplay.
    return "network-error";
  }

  // Any non-zero status with an error object is a real HTTP error (4xx / 5xx) from
  // PostgREST or the DB. Log it for the developer; do not queue.
  console.error(
    `[DoodleBot] game_results INSERT rejected (HTTP ${status}):`,
    error,
  );
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
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback — Math.random is not cryptographically strong, but the queueId is only used
  // for local deduplication, not as a security token.
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
function enqueue(result: GameResultInsert): void {
  const queue = readQueue();
  queue.push({ queueId: generateQueueId(), result });
  writeQueue(queue);
}

/**
 * True while a flushQueue() call is in progress.
 *
 * JavaScript is single-threaded, but `async` functions yield at every `await`, so two
 * callers can interleave: one triggered by a successful submit and one by `window.online`
 * firing moments later could both reach readQueue() before either has written back, causing
 * the same entries to be INSERTed twice.
 *
 * This flag prevents overlapping flush executions. The second caller returns immediately;
 * the already-running flush handles the full queue snapshot it captured.
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
 *   Only one execution runs at a time (_isFlushing guard). A second concurrent caller
 *   returns immediately and loses nothing — the in-flight flush processes the full queue.
 *
 * Idempotency / deduplication guarantee:
 *   Duplicate queueId entries are removed before any INSERT is attempted, so calling
 *   flushQueue twice in a row cannot double-count the same round.
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

    // Collect the queueIds we will attempt to submit in this pass. Deduplication within
    // this snapshot is defence-in-depth; under normal operation each queueId is unique.
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
    // Why: enqueue() may have been called while the async loop above was running
    // (e.g. the player completed another round mid-flush). If we wrote `remaining`
    // directly — a subset of the snapshot we read at the start — we would silently
    // discard those newly-added items.
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
 * The listener is registered exactly once, even if this module is re-evaluated during
 * Next.js Fast Refresh. A plain module-level boolean would reset on each re-evaluation, so
 * the flag is stored on `globalThis` which persists across module reloads in the same page.
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
