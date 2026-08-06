import type { GameResultInput, LeaderboardRow } from "./types";
import { getSupabaseClient } from "./supabase";
import { RANKING_WEIGHT_GUESSES, RANKING_WEIGHT_SPEED, ROUND_SECONDS } from "./constants";

const LOCAL_LEADERBOARD_KEY = "doodlebot.local-leaderboard";
const LOCAL_PARTICIPANTS_KEY = "doodlebot.local-participants";

interface LocalParticipant {
  id: string;
  name: string;
}

interface LocalResult {
  participantId: string;
  word: string;
  correct: boolean;
  timeTakenSeconds: number | null;
  timestamp: number;
}

export async function createParticipant(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name cannot be empty");
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("participants")
      .insert([{ name: trimmed }])
      .select("id")
      .single();

    if (!error && data?.id) {
      // Store locally as well for fallback
      storeLocalParticipant(data.id, trimmed);
      return data.id;
    }
  } catch (err) {
    console.warn("Supabase insert participant failed/skipped, using local fallback", err);
  }

  // Fallback to local UUID
  const localId = typeof crypto !== "undefined" && crypto.randomUUID 
    ? crypto.randomUUID() 
    : `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  storeLocalParticipant(localId, trimmed);
  return localId;
}

function storeLocalParticipant(id: string, name: string) {
  if (typeof window === "undefined") return;
  try {
    const existing: Record<string, string> = JSON.parse(localStorage.getItem(LOCAL_PARTICIPANTS_KEY) || "{}");
    existing[id] = name;
    localStorage.getItem(LOCAL_PARTICIPANTS_KEY);
    localStorage.setItem(LOCAL_PARTICIPANTS_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error("Failed to write participant to localStorage", e);
  }
}

export async function submitResult(result: GameResultInput): Promise<void> {
  // Always write to local storage first so results are guaranteed saved
  saveLocalResult(result);

  // Try submitting to Supabase
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("game_results").insert([
      {
        participant_id: result.participantId,
        word: result.word,
        correct: result.correct,
        time_taken_seconds: result.timeTakenSeconds,
      },
    ]);

    if (error) {
      console.warn("Supabase submit result error:", error);
    }
  } catch (err) {
    console.warn("Supabase submit skipped or offline:", err);
  }

  // Notify cross-tab listeners via BroadcastChannel if available
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      const bc = new BroadcastChannel("doodlebot_leaderboard_channel");
      bc.postMessage({ type: "RESULT_SUBMITTED", result });
      bc.close();
    } catch (_) {}
  }
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

