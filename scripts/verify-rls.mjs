#!/usr/bin/env node
/**
 * Runs Issue #4's acceptance test against the live Supabase project, using the anon key exactly
 * as the browser bundle would: insert into participants and game_results should succeed, select
 * on either table should be denied, and select * from leaderboard_view should succeed.
 *
 * This is the one part of #4 that cannot be verified read-only: RLS with no matching SELECT
 * policy returns `200 []` to an anon SELECT, indistinguishable from a permissive policy on an
 * empty table. Only an actual insert-then-select proves which one is true.
 *
 * WRITES REAL ROWS. The anon key has no DELETE policy (by design — see supabase/schema.sql), so
 * anything this script inserts stays in the table permanently. Refuses to run unless you pass
 * --i-will-clean-up, and even then, only point this at a throwaway/non-production project —
 * never at the project the event will actually use. Cleanup requires dashboard/service-role
 * access, which this script deliberately does not have.
 *
 * Run: node scripts/verify-rls.mjs --i-will-clean-up
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

if (!process.argv.includes("--i-will-clean-up")) {
  console.error(
    "Refusing to run: this script INSERTs real rows that the anon key cannot delete.\n" +
      "Point NEXT_PUBLIC_SUPABASE_URL at a throwaway/non-production project, then re-run with\n" +
      "  node scripts/verify-rls.mjs --i-will-clean-up",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal .env.local reader — no dotenv dependency for one script.
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) {
    console.error(".env.local not found. Copy .env.example -> .env.local and fill it in first.");
    process.exit(1);
  }
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = loadEnvLocal();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY || URL.includes("your-project")) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing or unset in .env.local.");
  process.exit(1);
}

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  "Content-Type": "application/json",
};

let failed = false;
function report(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

async function main() {
  console.log(`Target: ${URL}\n(No cleanup will be performed — see the header comment.)\n`);

  // 1. anon INSERT into participants should succeed.
  const participantName = `rls-check-${Date.now()}`;
  const insertParticipant = await fetch(`${URL}/rest/v1/participants`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name: participantName }),
  });
  const participantBody = await insertParticipant.json().catch(() => null);
  const participantId = Array.isArray(participantBody) ? participantBody[0]?.id : undefined;
  report(
    "anon INSERT into participants succeeds",
    insertParticipant.ok && !!participantId,
    `HTTP ${insertParticipant.status}`,
  );

  // 2. anon SELECT on participants should be denied (empty result is NOT proof by itself, but
  //    combined with the insert above we now know the table is non-empty, so an empty SELECT
  //    here is a real signal, not row-count ambiguity).
  const selectParticipants = await fetch(
    `${URL}/rest/v1/participants?select=id&name=eq.${encodeURIComponent(participantName)}`,
    { headers },
  );
  const selectParticipantsBody = await selectParticipants.json().catch(() => null);
  const sawOwnRow = Array.isArray(selectParticipantsBody) && selectParticipantsBody.length > 0;
  report(
    "anon SELECT on participants is denied",
    selectParticipants.status === 401 || selectParticipants.status === 403 || !sawOwnRow,
    `HTTP ${selectParticipants.status}, returned ${Array.isArray(selectParticipantsBody) ? selectParticipantsBody.length : "?"} rows (row we just inserted IS in the table)`,
  );

  if (!participantId) {
    report("anon INSERT into game_results succeeds", false, "skipped — no participant id from step 1");
    report("anon SELECT on game_results is denied", false, "skipped — no participant id from step 1");
  } else {
    // 3. anon INSERT into game_results should succeed.
    const insertResult = await fetch(`${URL}/rest/v1/game_results`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        participant_id: participantId,
        word: "rls-check",
        correct: true,
        time_taken_seconds: 1.0,
      }),
    });
    report("anon INSERT into game_results succeeds", insertResult.ok, `HTTP ${insertResult.status}`);

    // 4. anon SELECT on game_results should be denied.
    const selectResults = await fetch(
      `${URL}/rest/v1/game_results?select=id&participant_id=eq.${participantId}`,
      { headers },
    );
    const selectResultsBody = await selectResults.json().catch(() => null);
    const sawOwnResult = Array.isArray(selectResultsBody) && selectResultsBody.length > 0;
    report(
      "anon SELECT on game_results is denied",
      selectResults.status === 401 || selectResults.status === 403 || !sawOwnResult,
      `HTTP ${selectResults.status}, returned ${Array.isArray(selectResultsBody) ? selectResultsBody.length : "?"} rows (row we just inserted IS in the table)`,
    );
  }

  // 5. anon SELECT on leaderboard_view should succeed.
  const selectView = await fetch(`${URL}/rest/v1/leaderboard_view?select=*&limit=1`, { headers });
  report("anon SELECT on leaderboard_view succeeds", selectView.ok, `HTTP ${selectView.status}`);

  console.log(
    `\n${participantId ? `Inserted participant ${participantId} ("${participantName}") and a matching game_results row.` : "No rows were inserted."}` +
      "\nThe anon key cannot delete them — remove manually via the Supabase dashboard if this is not a throwaway project.",
  );

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("verify-rls.mjs crashed:", err);
  process.exit(1);
});
