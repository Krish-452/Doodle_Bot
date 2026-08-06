-- DoodleBot — fake seed data for exercising leaderboard_view (Issue #4 acceptance:
-- "Seeded with ~20 fake rows, the view returns a sensible ranking").
--
-- Run this against a NON-PRODUCTION Supabase project (a throwaway project, or a local
-- `supabase start` instance) after applying schema.sql. Do not run it against the project the
-- event will actually use — these rows would sit permanently on the real leaderboard, since the
-- anon key has no DELETE policy.
--
-- Uses service-role / SQL-editor access (bypasses RLS, which is expected — RLS governs the anon
-- REST API, not the SQL editor). Run scripts/verify-rls.mjs separately to exercise the anon path.
--
-- 6 participants, ~24 rows total: a mix of wins, timeouts, and a couple of ties so the ranking
-- formula's tie-break rules (successful_guesses, then best single time) actually get exercised.

begin;

with new_participants as (
  insert into participants (name) values
    ('Aarav'),
    ('Diya'),
    ('Kabir'),
    ('Ishita'),
    ('Rohan'),
    ('Zara')
  returning id, name
),
p as (
  select id, name, row_number() over (order by name) as n from new_participants
)
insert into game_results (participant_id, word, correct, time_taken_seconds)
select id, word, correct, time_taken_seconds
from (
  -- Aarav: 4 wins, fast — should rank near the top on speed bonus.
  select (select id from p where name = 'Aarav'), 'couch',    true,  8.4
  union all select (select id from p where name = 'Aarav'), 'guitar',  true,  11.2
  union all select (select id from p where name = 'Aarav'), 'umbrella',true,  14.9
  union all select (select id from p where name = 'Aarav'), 'octopus', true,  6.7
  union all select (select id from p where name = 'Aarav'), 'bicycle', false, null

  -- Diya: most successful guesses (5) but slower — tests "played a lot and did well".
  union all select (select id from p where name = 'Diya'), 'couch',    true,  22.1
  union all select (select id from p where name = 'Diya'), 'guitar',   true,  28.4
  union all select (select id from p where name = 'Diya'), 'umbrella', true,  19.8
  union all select (select id from p where name = 'Diya'), 'octopus',  true,  25.0
  union all select (select id from p where name = 'Diya'), 'bicycle',  true,  30.2
  union all select (select id from p where name = 'Diya'), 'cactus',   false, null

  -- Kabir: exact tie with Aarav on successful_guesses (4) but slower overall — tie-break test.
  union all select (select id from p where name = 'Kabir'), 'couch',    true,  15.0
  union all select (select id from p where name = 'Kabir'), 'guitar',   true,  18.3
  union all select (select id from p where name = 'Kabir'), 'umbrella', true,  20.1
  union all select (select id from p where name = 'Kabir'), 'octopus',  true,  12.6
  union all select (select id from p where name = 'Kabir'), 'bicycle',  false, null
  union all select (select id from p where name = 'Kabir'), 'cactus',   false, null

  -- Ishita: single very fast win plus mostly timeouts — low volume, high speed bonus per win.
  union all select (select id from p where name = 'Ishita'), 'couch',    true,  5.1
  union all select (select id from p where name = 'Ishita'), 'guitar',   false, null
  union all select (select id from p where name = 'Ishita'), 'umbrella', false, null

  -- Rohan: no wins at all — exercises bestTimeSeconds = null / "No wins yet" rendering.
  union all select (select id from p where name = 'Rohan'), 'couch',    false, null
  union all select (select id from p where name = 'Rohan'), 'guitar',   false, null

  -- Zara: one game, one win — smallest sample size.
  union all select (select id from p where name = 'Zara'), 'octopus', true, 9.9
) as rows(participant_id, word, correct, time_taken_seconds);

commit;

-- Expected ranking after this seed (score = successful_guesses*100 + speed_bonus*1, speed_bonus
-- = sum of max(0, 90 - time_taken_seconds) over correct rounds):
--   Diya   5 wins  -> highest score from volume
--   Aarav  4 wins, very fast -> highest speed_bonus of the 4-win group
--   Kabir  4 wins, slower    -> ties Aarav on successful_guesses, loses the tie-break on best time
--   Ishita 1 win, very fast
--   Zara   1 win
--   Rohan  0 wins  -> score 0, bestTimeSeconds null
-- Exact order depends on the live weights; the point is that scores differ and nulls render
-- correctly, not that this comment is authoritative — read leaderboard_view after seeding.
