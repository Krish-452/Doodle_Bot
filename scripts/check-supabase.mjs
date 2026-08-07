#!/usr/bin/env node
/**
 * Read-only(-ish) preflight for Issue #4: reports exactly what's missing on the live Supabase
 * project in seconds, instead of another dashboard-access round trip.
 *
 * Distinct from scripts/verify-rls.mjs, which performs real inserts that the anon key can never
 * delete and is deliberately gated behind --i-will-clean-up for a throwaway project only. This
 * script is safe to run against the actual event project at any time — every probe here is
 * designed to leave zero rows behind, including the RLS check (see step 5).
 *
 * Run: node scripts/check-supabase.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Minimal .env.local reader — copied from verify-rls.mjs rather than shared, for one script's
// worth of duplication either way.
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
function pass(label, detail) {
  console.log(`PASS  ${label}${detail ? " — " + detail : ""}`);
}
function fail(label, detail, hint) {
  console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
  if (hint) console.log(`      -> ${hint}`);
  failed = true;
}
function info(label, detail) {
  console.log(`INFO  ${label}${detail ? " — " + detail : ""}`);
}

async function getJson(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function main() {
  console.log(`Target: ${URL}\n`);

  // ---------------------------------------------------------------------------
  // 1-2. Tables exist.
  // ---------------------------------------------------------------------------
  for (const table of ["participants", "game_results"]) {
    const { res } = await getJson(`${table}?select=id&limit=1`);
    if (res.status === 200) {
      pass(`${table} table exists`);
    } else {
      fail(
        `${table} table exists`,
        `HTTP ${res.status}`,
        `Run supabase/schema.sql in the Supabase SQL Editor for this project.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 3. leaderboard_view resolves the exact columns lib/data.ts asks for.
  // ---------------------------------------------------------------------------
  const viewCols = "participant_id,name,score,successful_guesses,total_games,best_time_seconds";
  {
    const { res } = await getJson(`leaderboard_view?select=${viewCols}&limit=1`);
    if (res.status === 200) {
      pass("leaderboard_view exposes the columns lib/data.ts expects", viewCols);
    } else {
      fail(
        "leaderboard_view exposes the columns lib/data.ts expects",
        `HTTP ${res.status}`,
        `Run supabase/schema.sql — its view definition emits exactly these columns.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 4. leaderboard_view has no `rank` column — the assumption LeaderboardRow.rank is built on.
  //
  // Expected failure code is 42809 ("wrong_object_type"), not the more intuitive 42703
  // ("undefined_column") — confirmed empirically against this project and already documented
  // in supabase/schema.sql's header comment. `rank` collides with the SQL-standard `rank()`
  // window function, and PostgREST's column parser reports the mismatch differently than a
  // plain missing column.
  // ---------------------------------------------------------------------------
  {
    const { res, body } = await getJson("leaderboard_view?select=rank&limit=1");
    const wrongObjectType = res.status === 400 && body?.code === "42809";
    if (wrongObjectType) {
      pass("leaderboard_view has no rank column, as lib/data.ts assumes");
    } else if (res.status === 200) {
      fail(
        "leaderboard_view has no rank column, as lib/data.ts assumes",
        "select=rank succeeded — the view now HAS a rank column",
        "lib/data.ts assigns rank client-side and ignores any server-provided one; check whether that's now redundant or conflicting.",
      );
    } else {
      fail("leaderboard_view has no rank column, as lib/data.ts assumes", `HTTP ${res.status}, code ${body?.code}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. RLS INSERT probe on game_results, engineered to never persist a row.
  //
  // participant_id points at a UUID that cannot exist (nil UUID). Combined with correct: false
  // and time_taken_seconds: null (which satisfies time_present_iff_correct), the ONLY thing that
  // can reject this row is the foreign key — so:
  //   - RLS denies the insert first  -> 401/403, nothing ever reaches the FK check.
  //   - RLS permits it, FK then fails -> 409 (or 400 with code 23503), rolled back, 0 rows written.
  //   - Anything else (esp. 201)      -> schema mismatch; flagged loudly since it DID persist.
  // ---------------------------------------------------------------------------
  {
    const res = await fetch(`${URL}/rest/v1/game_results`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        participant_id: "00000000-0000-4000-8000-000000000000",
        word: "__preflight_probe__",
        correct: false,
        time_taken_seconds: null,
      }),
    });
    const body = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403 || body?.code === "42501") {
      fail(
        "anon INSERT on game_results is permitted (required for gameplay)",
        `HTTP ${res.status} — RLS denied the insert`,
        "Run supabase/schema.sql in the SQL Editor — its game_results_anon_insert policy is missing or not applied.",
      );
    } else if (res.status === 409 || body?.code === "23503") {
      pass(
        "anon INSERT on game_results is permitted (required for gameplay)",
        "RLS let the insert through; it was rejected downstream by the foreign key instead — nothing persisted",
      );
    } else if (res.status === 201) {
      fail(
        "anon INSERT on game_results is permitted (required for gameplay)",
        "HTTP 201 — the foreign key did not reject participant_id 00000000-0000-4000-8000-000000000000",
        `A row DID persist. Manually delete word = '__preflight_probe__' from game_results, and check that participant_id really references participants(id) on delete cascade.`,
      );
    } else {
      fail("anon INSERT on game_results is permitted (required for gameplay)", `unexpected HTTP ${res.status}, code ${body?.code}`);
    }
  }

  // ---------------------------------------------------------------------------
  // participants' name CHECK constraint (char_length(trim(name)) between 1 and 24) is
  // deliberately NOT probed here. An earlier version of this script sent an empty name expecting
  // a CHECK violation to reject it — but on a live project where that constraint turns out to be
  // missing (as happened once already; see git history), nothing else stops the row from
  // persisting, and the anon key has no DELETE policy to undo it. There is no REST-only way to
  // test a CHECK constraint that is safe if the constraint isn't actually there. Confirm it in
  // the dashboard instead — see the handoff note in supabase/schema.sql and the README.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // 6. SELECT-denial honesty. Genuinely can't be proven read-only while both tables are empty.
  // ---------------------------------------------------------------------------
  for (const table of ["participants", "game_results"]) {
    const { res, body } = await getJson(`${table}?select=id&limit=1`);
    const rowCount = Array.isArray(body) ? body.length : null;
    if (res.status === 200 && rowCount === 0) {
      info(
        `${table}: anon SELECT returned 200 [] — cannot prove RLS denies this vs. the table simply being empty`,
        "Re-run this script after the first real round: once a row exists, a continued 200 [] IS proof of denial.",
      );
    } else if (res.status === 200 && rowCount > 0) {
      fail(
        `${table}: anon SELECT should be denied`,
        `HTTP 200 returned ${rowCount} row(s) — anon can read raw ${table} rows`,
        "This is the leak #4 exists to prevent. Check for a stray SELECT policy in the dashboard.",
      );
    } else if (res.status === 401 || res.status === 403) {
      pass(`${table}: anon SELECT is denied`, `HTTP ${res.status}`);
    }
  }

  console.log(
    failed
      ? "\nSome checks failed — see FAIL lines above for what to run in the SQL Editor."
      : "\nAll hard checks passed. See INFO lines for what still needs a live round to confirm.",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("check-supabase.mjs crashed:", err);
  process.exit(1);
});
