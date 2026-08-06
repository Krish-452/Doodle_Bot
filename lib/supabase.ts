import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client factory — no data access here.
 *
 * lib/data.ts owns createParticipant, submitResult, fetchLeaderboard, and the offline retry
 * queue (Issue #12). This module's only job is producing the singleton client both lib/data.ts
 * and the leaderboard's Realtime subscription (LeaderboardClient.tsx) import.
 *
 * Writes go directly from client components with the anon key — no API route handler as a
 * proxy, since that would add a hop for no benefit and break the offline queue.
 * See docs/02-architecture.md § 7.
 *
 * The anon key is public and ships in the bundle. RLS is the actual security boundary: anon may
 * INSERT into both tables and SELECT only from the aggregate leaderboard view.
 * See docs/02-architecture.md § 6, supabase/schema.sql.
 */

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
