import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULT_QUEUE_STORAGE_KEY } from "./constants";

/**
 * Exercises three things without a live Supabase project:
 *
 *  - Issue #12's offline retry queue: submitResult enqueues on a network failure, flushes on the
 *    next successful submit and on the window "online" event, and an overlapping double flush
 *    does not double-submit a queued round.
 *  - Issue #14's empty-vs-unreachable fix: fetchLeaderboard reports source: "remote" on a real
 *    zero-row response instead of silently falling back to local data, and source: "local" (with
 *    the failure reason) when the remote query actually fails.
 *  - Issue #4's RLS fix: createParticipant sends a client-generated id and never chains .select()
 *    on the insert — RETURNING evaluates under SELECT policies, which anon doesn't have on
 *    participants — and returns that same id whether or not the remote insert succeeds, so a
 *    session never gets orphaned under a second, never-persisted id.
 *
 * No jsdom, no vitest.config.ts — lib/data.ts only touches `window`/`localStorage` through the
 * bare global identifiers (never `document` or any other DOM API), so two minimal stubs are
 * enough. They're set up before lib/data.ts is imported: its module-level window.online
 * listener registers at import time, so `window` must already exist when that runs. A dynamic
 * import inside beforeAll (rather than a static import at the top of this file) guarantees the
 * stubs below run first — static imports are evaluated as part of module linking, before any of
 * this file's own top-level statements.
 */

const mockState = vi.hoisted(() => ({
  insertCalls: [] as unknown[],
  /** Set if any test's code chains .select() onto an insert() — see selectCalledOnInsert below. */
  selectCalledOnInsert: false,
  /** What the next (and subsequent, until changed) mocked insert() call resolves to. */
  nextResult: { error: null as { message: string; code?: string } | null, status: 201 },
  /** What the next mocked leaderboard_view select() call resolves to. */
  nextSelectResult: { data: null as unknown[] | null, error: null as { message: string } | null },
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    // Table name isn't needed — every insert() call in lib/data.ts (game_results and, since #4,
    // participants) shares nextResult, and every select() call is on leaderboard_view.
    from: () => ({
      // insert() returns a thenable that is ALSO chainable via .select(), the same shape
      // @supabase/postgrest-js's real builder has. That's what lets a test prove createParticipant
      // never chains .select() onto its insert (see the RLS/RETURNING comment above) — a stray
      // `.select()` would flip selectCalledOnInsert, which a plain `insert: async () => ...` mock
      // couldn't have caught: it never expose a .select() method to call in the first place.
      insert: (payload: unknown) => {
        mockState.insertCalls.push(payload);
        const result = { error: mockState.nextResult.error, status: mockState.nextResult.status };
        return {
          then(resolve: (value: typeof result) => void) {
            resolve(result);
          },
          select() {
            mockState.selectCalledOnInsert = true;
            return { single: async () => ({ data: null, error: mockState.nextResult.error }) };
          },
        };
      },
      select: async () => mockState.nextSelectResult,
    }),
  }),
}));

/** Minimal in-memory localStorage — only getItem/setItem, which is all lib/data.ts calls. */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

const memoryStorage = new MemoryStorage();
(globalThis as Record<string, unknown>).localStorage = memoryStorage;
// EventTarget is a real Node global with addEventListener/dispatchEvent built in — enough to
// satisfy lib/data.ts's `typeof window !== "undefined"` guard and its one window.addEventListener
// call, and to let this file simulate the "online" event with a real dispatchEvent.
const windowStub = new EventTarget();
(globalThis as Record<string, unknown>).window = windowStub;

let submitResult: typeof import("./data").submitResult;
let fetchLeaderboard: typeof import("./data").fetchLeaderboard;
let createParticipant: typeof import("./data").createParticipant;

beforeAll(async () => {
  ({ submitResult, fetchLeaderboard, createParticipant } = await import("./data"));
});

function readQueueLength(): number {
  const raw = memoryStorage.getItem(RESULT_QUEUE_STORAGE_KEY);
  if (!raw) return 0;
  return (JSON.parse(raw) as unknown[]).length;
}

async function fireOnlineAndSettle() {
  windowStub.dispatchEvent(new Event("online"));
  // The listener is fire-and-forget (flushQueue().catch(...)); a macrotask tick lets its
  // microtask chain fully resolve before assertions run.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const sampleResult = {
  participantId: "11111111-1111-4111-8111-111111111111",
  word: "couch",
  correct: true,
  timeTakenSeconds: 12.3,
};

beforeEach(() => {
  memoryStorage.clear();
  mockState.insertCalls.length = 0;
  mockState.selectCalledOnInsert = false;
  mockState.nextResult = { error: null, status: 201 };
  mockState.nextSelectResult = { data: null, error: null };
});

describe("createParticipant (Issue #4)", () => {
  it("sends a client-generated id and never chains .select() onto the insert", async () => {
    mockState.nextResult = { error: null, status: 201 };

    const id = await createParticipant("Test Player");

    expect(mockState.insertCalls).toHaveLength(1);
    expect(mockState.insertCalls[0]).toEqual([{ id, name: "Test Player" }]);
    // The real bug this guards against: `.insert(...).select("id").single()` compiles to
    // `INSERT ... RETURNING id`, which Postgres evaluates under SELECT policies — and anon has
    // none on participants (supabase/schema.sql, Issue #4). A .select() call here would have
    // made every participant creation fail even with the schema applied correctly.
    expect(mockState.selectCalledOnInsert).toBe(false);
    expect(id).toBeTruthy();
  });

  it("returns the same id whether or not the remote insert succeeds, so a later retry can't orphan the session", async () => {
    mockState.nextResult = {
      error: { message: "new row violates row-level security policy", code: "42501" },
      status: 401,
    };

    const id = await createParticipant("Test Player");

    expect(mockState.insertCalls).toHaveLength(1);
    // Same id sent in the (rejected) insert as the one returned to the caller — previously a
    // rejected insert generated a second, different local-only id, so any later attemptInsert
    // retry for this session would fail the participant_id foreign key forever.
    expect(mockState.insertCalls[0]).toEqual([{ id, name: "Test Player" }]);
    expect(id).toBeTruthy();
  });
});

describe("submitResult offline queue (Issue #12)", () => {
  it("queues silently when the insert fails with a network error", async () => {
    mockState.nextResult = { error: { message: "offline" }, status: 0 };

    await submitResult(sampleResult);

    expect(mockState.insertCalls).toHaveLength(1);
    expect(readQueueLength()).toBe(1);
  });

  it("does not queue an insert the DB rejects (retrying would reproduce the same rejection)", async () => {
    mockState.nextResult = { error: { message: "constraint violation" }, status: 409 };

    await submitResult(sampleResult);

    expect(readQueueLength()).toBe(0);
  });

  it("flushes the queue on the next successful submit", async () => {
    mockState.nextResult = { error: { message: "offline" }, status: 0 };
    await submitResult(sampleResult); // queues
    expect(readQueueLength()).toBe(1);

    mockState.nextResult = { error: null, status: 201 }; // back online
    mockState.insertCalls.length = 0;
    await submitResult({ ...sampleResult, word: "guitar" }); // succeeds, then flushes the backlog

    // One insert for the live submit itself, one for the flushed backlog item.
    expect(mockState.insertCalls).toHaveLength(2);
    expect(readQueueLength()).toBe(0);

    // The flushed payload is exactly the four documented columns — no sketch data can appear
    // by construction, but this pins the actual shape sent over the wire.
    expect(Object.keys(mockState.insertCalls[0] as object).sort()).toEqual([
      "correct",
      "participant_id",
      "time_taken_seconds",
      "word",
    ]);
  });

  it("flushes the queue on the window 'online' event", async () => {
    mockState.nextResult = { error: { message: "offline" }, status: 0 };
    await submitResult(sampleResult);
    expect(readQueueLength()).toBe(1);

    mockState.nextResult = { error: null, status: 201 };
    mockState.insertCalls.length = 0;
    await fireOnlineAndSettle();

    expect(mockState.insertCalls).toHaveLength(1);
    expect(readQueueLength()).toBe(0);
  });

  it("does not double-submit when two flushes overlap (the _isFlushing guard)", async () => {
    mockState.nextResult = { error: { message: "offline" }, status: 0 };
    await submitResult(sampleResult);
    await submitResult({ ...sampleResult, word: "guitar" });
    expect(readQueueLength()).toBe(2);

    mockState.nextResult = { error: null, status: 201 };
    mockState.insertCalls.length = 0;

    // Two "online" events back to back, as a flaky connection reconnecting twice in quick
    // succession might. Both handlers fire flushQueue() synchronously and neither is awaited by
    // the dispatch itself, so the second call's _isFlushing check runs before the first flush
    // has reached its own first await — without the guard this would double-submit.
    windowStub.dispatchEvent(new Event("online"));
    windowStub.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Exactly one insert per queued item — never 3 or 4.
    expect(mockState.insertCalls).toHaveLength(2);
    expect(readQueueLength()).toBe(0);
  });
});

describe("fetchLeaderboard: empty vs unreachable (Issue #14)", () => {
  it("reports source: 'remote' and empty rows when the remote query succeeds with zero rows, not the local fallback", async () => {
    // Populate local data first (submitResult always writes locally, regardless of the mocked
    // remote outcome), so a wrongful fallback to it would be detectable below.
    await submitResult(sampleResult);

    mockState.nextSelectResult = { data: [], error: null };
    const snapshot = await fetchLeaderboard();

    // Before the fix, `data.length > 0` being false sent this straight to
    // computeLocalLeaderboard(), which would have returned the row seeded above instead of [].
    expect(snapshot.source).toBe("remote");
    expect(snapshot.error).toBeNull();
    expect(snapshot.rows).toEqual([]);
  });

  it("reports source: 'local' with the failure reason when the remote query actually fails", async () => {
    await submitResult(sampleResult); // seeds local data

    mockState.nextSelectResult = { data: null, error: { message: "relation does not exist" } };
    const snapshot = await fetchLeaderboard();

    expect(snapshot.source).toBe("local");
    expect(snapshot.error).toBe("relation does not exist");
    expect(snapshot.rows.length).toBeGreaterThan(0);
    expect(snapshot.rows[0].participantId).toBe(sampleResult.participantId);
  });
});
