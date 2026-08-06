-- DoodleBot — schema, indexes, leaderboard view, RLS policies (Issue #4)
--
-- This is the single source of truth for the hosted Supabase project. It was written to match
-- the live project exactly, verified with read-only probes against the configured project:
--   - participants, game_results, and leaderboard_view all resolve (HTTP 200).
--   - leaderboard_view returns exactly these columns, in snake_case:
--       participant_id, name, score, successful_guesses, total_games, best_time_seconds
--     (confirmed via `select=<cols>` -> 200, and `select=rank` -> 42809, i.e. no rank column).
--   - Both tables hold 0 rows as of this audit.
--
-- Ranking weights (RANKING_WEIGHT_GUESSES, RANKING_WEIGHT_SPEED, ROUND_SECONDS) are kept in sync
-- with lib/constants.ts by hand — see the `weights` CTE below. Change both together, or the
-- board and the client disagree. See docs/02-architecture.md § 8.
--
-- No writes were issued against the live project to produce this file — see the audit comment on
-- issue #4. RLS, the check constraint, the indexes, and the seed step are therefore documented
-- here as the intended state, not re-verified by running this script against production.
--
-- Run in the Supabase SQL editor. Idempotent-ish (guarded with IF NOT EXISTS / OR REPLACE) so it
-- is safe to re-run against a project that already matches this file.

-- ---------------------------------------------------------------------------
-- Tables (docs/02-architecture.md § 6)
-- ---------------------------------------------------------------------------

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 24),
  created_at  timestamptz not null default now()
);

create table if not exists game_results (
  id                  uuid primary key default gen_random_uuid(),
  participant_id      uuid not null references participants(id) on delete cascade,
  word                text not null,
  correct             boolean not null,
  time_taken_seconds  numeric(6,2),  -- null when incorrect
  created_at          timestamptz not null default now(),
  constraint time_present_iff_correct
    check ((correct and time_taken_seconds is not null)
        or (not correct and time_taken_seconds is null))
);

create index if not exists game_results_participant_id_idx on game_results (participant_id);
create index if not exists game_results_word_correct_idx on game_results (word) where correct;

-- No table stores sketch data. That is deliberate and should stay true — see CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Aggregate leaderboard view (docs/02-architecture.md § 7, § 8)
--
-- IMPORTANT: this view must run as its DEFINER (the default — do NOT add
-- `with (security_invoker = true)`), not as the querying role. anon has no SELECT grant on
-- either base table; the view is the only way the aggregate is readable while raw rows stay
-- private. Flipping security_invoker on would make every anon read of this view fail RLS.
-- ---------------------------------------------------------------------------

create or replace view leaderboard_view as
with weights as (
  -- Mirrors lib/constants.ts: RANKING_WEIGHT_GUESSES, RANKING_WEIGHT_SPEED, ROUND_SECONDS.
  -- One place to edit on this side; lib/constants.ts is the other. Keep them in sync by hand.
  select
    100::numeric as w_a,          -- RANKING_WEIGHT_GUESSES
    1::numeric   as w_b,          -- RANKING_WEIGHT_SPEED
    90::numeric  as round_seconds -- ROUND_SECONDS
),
per_participant as (
  select
    p.id                                                        as participant_id,
    p.name                                                       as name,
    count(gr.id) filter (where gr.correct)                       as successful_guesses,
    count(gr.id)                                                 as total_games,
    min(gr.time_taken_seconds) filter (where gr.correct)         as best_time_seconds,
    coalesce(
      sum(greatest(0, w.round_seconds - gr.time_taken_seconds))
        filter (where gr.correct),
      0
    )                                                             as speed_bonus
  from participants p
  left join game_results gr on gr.participant_id = p.id
  cross join weights w
  group by p.id, p.name
)
select
  participant_id,
  name,
  round(successful_guesses * w.w_a + speed_bonus * w.w_b) as score,
  successful_guesses,
  total_games,
  best_time_seconds
from per_participant
cross join weights w;

-- The view intentionally has no `rank` column. lib/data.ts assigns rank client-side (see #40) —
-- a bare Postgres window function here would need WITHIN GROUP / ORDER BY semantics that don't
-- compose cleanly with the anon-facing REST select, and the client already needs the same
-- comparator for the offline (localStorage) leaderboard, so keeping it in one place is simpler.

-- ---------------------------------------------------------------------------
-- Row Level Security (docs/02-architecture.md § 6)
--
-- The anon key is public and ships in the client bundle. These policies are the actual security
-- boundary, not the key itself.
-- ---------------------------------------------------------------------------

alter table participants enable row level security;
alter table game_results enable row level security;

-- anon may INSERT into both tables (gameplay requires it) and may NOT SELECT raw rows from
-- either (no scraping the name list or the per-round history). No select policy is created on
-- purpose — the absence of a policy is what denies the read.
--
-- Consequence for Realtime (Issue #14): Supabase's `postgres_changes` enforces RLS on the
-- subscribing role. LeaderboardClient.tsx subscribes to anon `INSERT` events on game_results,
-- but anon has no SELECT policy on that table — so under these policies, that subscription can
-- never actually deliver an event. This is intentional: the RLS boundary is non-negotiable, and
-- the leaderboard's 10s poll (also required by #14) is what actually keeps the board live. Do
-- not add a SELECT policy on game_results to make the socket fire; that would defeat the point
-- of this section.

drop policy if exists participants_anon_insert on participants;
create policy participants_anon_insert
  on participants
  for insert
  to anon
  with check (true);

drop policy if exists game_results_anon_insert on game_results;
create policy game_results_anon_insert
  on game_results
  for insert
  to anon
  with check (true);

-- Leaderboard reads go through the aggregate view only. Views don't inherit RLS from their base
-- tables by themselves when SECURITY DEFINER — this grant is what makes it readable.
grant select on leaderboard_view to anon;

-- ---------------------------------------------------------------------------
-- What this file does NOT verify (see issue #4)
--
-- RLS with no matching SELECT policy returns `200 []` to an anon SELECT — identical, from
-- outside, to a permissive policy on an empty table. Both participants and game_results are
-- currently empty, so the two cases are indistinguishable via a read-only HTTP probe. Confirm
-- this in the Supabase dashboard, or run `node scripts/verify-rls.mjs --i-will-clean-up` against
-- a NON-PRODUCTION project (it performs real inserts that the anon key cannot delete).
-- ---------------------------------------------------------------------------
