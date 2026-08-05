import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client factory.
 *
 * Writes go directly from client components with the anon key — no API route handler as a
 * proxy; it adds a hop for no benefit and breaks the offline queue. The anon key is public and
 * ships in the bundle, so RLS is the actual security boundary, not this file: anon may INSERT
 * into both tables and SELECT only from the aggregate leaderboard view.
 * See docs/02-architecture.md § 6 and § 7.
 */

/** insert into participants → returns the id held in sessionStorage. */
export interface ParticipantInsert {
  name: string;
}

/** insert into game_results. */
export interface GameResultInsert {
  participant_id: string;
  word: string;
  correct: boolean;
  /** Null when incorrect — a CHECK constraint enforces the pairing. */
  time_taken_seconds: number | null;
}

// TODO: type the leaderboard view's rows here once the view exists. Its columns depend on the
// ranking formula, which is not finalised.

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example)",
    );
  }

  client = createClient(url, anonKey);
  return client;
}
