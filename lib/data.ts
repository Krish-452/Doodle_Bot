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

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from("leaderboard_view").select("*");
    if (!error && data && data.length > 0) {
      return data as LeaderboardRow[];
    }
  } catch (err) {
    // Supabase error or missing, fallback to local compute
  }

  return computeLocalLeaderboard();
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

    const rows: LeaderboardRow[] = Object.entries(statsMap).map(([pId, data]) => {
      const score = Math.round(
        data.successfulGuesses * RANKING_WEIGHT_GUESSES + data.speedBonus * RANKING_WEIGHT_SPEED
      );
      return {
        rank: 0,
        participantId: pId,
        name: data.name,
        score,
        successfulGuesses: data.successfulGuesses,
        gamesPlayed: data.gamesPlayed,
        bestTimeSeconds: data.bestTimeSeconds !== null ? Number(data.bestTimeSeconds.toFixed(1)) : null,
      };
    });

    // Sort by score desc, then successful guesses desc, then best time asc
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.successfulGuesses !== a.successfulGuesses) return b.successfulGuesses - a.successfulGuesses;
      if (a.bestTimeSeconds !== null && b.bestTimeSeconds !== null) {
        return a.bestTimeSeconds - b.bestTimeSeconds;
      }
      return 0;
    });

    return rows.map((row, idx) => ({ ...row, rank: idx + 1 }));
  } catch (e) {
    console.error("Failed to compute local leaderboard", e);
    return [];
  }
}

