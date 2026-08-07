# DoodleBot — System Architecture & Technical Design

**IEEE Ahmedabad University Student Branch — Club Carnival**

> Source: `DoodleBot.pdf`, section 2. The PDF left the stack open; this doc commits it to
> Next.js (App Router) + Tailwind v4 + Supabase + TensorFlow.js.

---

## 1. Stack decisions

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js, App Router | Static-friendly, one deploy target for game + leaderboard + any server routes |
| Styling | Tailwind CSS v4 | CSS-first config; IEEE palette lives in one `@theme` block |
| Inference | TensorFlow.js, WebGL backend | Pre-trained Quick, Draw!–derived classifiers ship in TF.js format — no export/conversion step to debug on a 2-day budget |
| Backend + DB | Supabase (Postgres) | Postgres aggregates fit the leaderboard queries directly; Realtime removes the need to hand-build live refresh |
| Hosting | Static-friendly host with HTTPS + IEEE subdomain | HTTPS is required — QR/camera-adjacent flows expect secure origins |

**The two hard constraints**, from the PDF, that survive any stack change:

1. Inference runs client-side in the drawing loop.
2. The backend stays minimal and low-maintenance — this is a short-lived event tool.

---

## 2. High-level architecture

DoodleBot is a **client-heavy** web application. Drawing and live AI guessing run entirely in the
browser to minimize server load and latency. The backend exists only for leaderboard persistence.

### Components

1. **Client (mobile web app)** — landing, name entry, word selection, drawing canvas, live
   inference, results
2. **AI recognition model** — sketch classifier, run in-browser via TensorFlow.js
3. **Backend** — Supabase: Postgres + auto-generated REST + Realtime
4. **Database** — participants, game results, aggregated leaderboard stats
5. **Leaderboard display** — the same app, a dedicated route optimized for a stall-facing screen

### System flow

```
[Participant Phone]
  → scans QR code
  → loads Landing Page
  → enters name → INSERT participants → participant_id held in sessionStorage
  → selects word (client-generated random 3-word set from the local word bank)
  → Drawing Canvas active
      → canvas sampled every ~400ms (only when strokes changed)
      → sample → TF.js model (in-browser)
      → model returns ranked guesses + confidence
      → top guess displayed live
  → on correct guess OR timer expiry:
      → result computed client-side (correct?, time taken)
      → INSERT game_results
      → Results Screen → "Play Again" loops back to Word Selection

[Stall Display Screen]
  → loads /leaderboard
  → subscribes to game_results INSERTs via Supabase Realtime
  → refetches the aggregate view on each insert (debounced)
  → falls back to polling every 10s if the socket drops
```

Note what does **not** cross the network: sketch data. Ever.

---

## 3. Why client-side inference

Running the sketch classifier in-browser rather than posting sketch data to a server for every
prediction is the load-bearing decision in this architecture:

- **Avoids server bottlenecks.** 20–30 concurrent users each predicting 2–3× per second would be
  50–90 inference requests/second against a server. Client-side, it is zero.
- **Removes dependency on stall internet** for the core gameplay loop. Only the final result needs
  to reach the server, and it can queue.
- **Reduces latency.** No network round-trip, so predictions feel instant.
- **Simplifies privacy.** Sketch data never leaves the device, which satisfies the PRD's
  "no sketch images retained" requirement by construction rather than by policy.

**Fallback:** if client-side inference proves infeasible on low-end devices, a server-side
inference endpoint can be added with sampling throttled hard. Do not build this preemptively.

---

## 4. Inference pipeline

### Model

A pre-trained sketch classifier over Quick, Draw!–style categories, in TF.js `LayersModel` or
`GraphModel` format. Served as a static asset from `public/model/` so it is cached by the CDN and
the service worker, not fetched from a third party at runtime.

> **Hour-0 task.** Source and validate the model before writing any game code. The word bank is
> *derived from* whichever classes the model actually handles well — not the other way around.
> See [PRD § risks](01-prd.md#7-risks-and-mitigations).

### Preprocessing

The canvas is drawn at device resolution but the model expects a small grayscale bitmap.

```
canvas (device px, black ink on white)
  → drawImage onto an offscreen 28×28 canvas
  → getImageData → grayscale
  → invert (models trained on Quick, Draw! expect white ink on black)
  → normalize to [0,1]
  → tensor of shape [1, 28, 28, 1]
```

Confirm the expected input shape, channel order, and ink polarity against the specific model
before building around these numbers. Getting polarity backwards produces a model that runs
perfectly and predicts nonsense.

### Loop

- Sample every **~400ms**, and **only if strokes changed** since the last sample. An idle canvas
  costs nothing.
- Wrap every inference in `tf.tidy()` to avoid leaking GPU tensors across a long session.
- Load the model **once**, at app start, and hold it in a module-level singleton. Never load per
  round.
- Warm the model with one dummy prediction on load — the first real inference is otherwise
  noticeably slow.

### Win condition

A round is won when the target word's accepted labels appear in the model's **top-1** with
confidence **≥ 0.25**, sustained across **2 consecutive samples**.

The two-sample requirement matters: single-frame confidence spikes are common mid-stroke and
produce wins that feel unearned and random. Both thresholds are tunable constants — expect to
adjust them during playtesting.

---

## 5. Word bank design

- Restricted to object classes the model handles **reliably**. Avoid obscure or mutually
  ambiguous categories.
- Target 40–60 words, loosely grouped by difficulty (easy/medium/hard) so selection can be balanced.
- Each word maps to **one or more** valid model class labels — some words have multiple acceptable
  matches (`couch` / `sofa`).
- Stored as a **static typed module** on the client. No database round-trip, no fetch.

```ts
// lib/word-bank.ts
export type Difficulty = "easy" | "medium" | "hard";

export interface Word {
  /** Display label shown to the participant. */
  id: string;
  /** Model class labels that count as a correct guess for this word. */
  labels: string[];
  difficulty: Difficulty;
}

export const WORD_BANK: Word[] = [
  { id: "couch", labels: ["couch", "sofa"], difficulty: "easy" },
  // ...
];
```

A TS module rather than JSON in `public/`: it is type-checked at build time, tree-shaken into the
bundle, and cannot 404 at the stall.

---

## 6. Data model

```sql
create table participants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 24),
  created_at  timestamptz not null default now()
);

create table game_results (
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

create index on game_results (participant_id);
create index on game_results (word) where correct;
```

No table stores sketch data. That is deliberate and should stay true.

### Derived metrics

Computed, not stored:

| Metric | Query |
| --- | --- |
| Fastest overall guess | `MIN(time_taken_seconds) WHERE correct` |
| Fastest guess per word | `MIN(time_taken_seconds) GROUP BY word WHERE correct` |
| Successful guesses per participant | `COUNT(*) GROUP BY participant_id WHERE correct` |
| Total games played | `COUNT(*)` on `game_results` |
| Overall ranking | See [§ 8](#8-ranking-logic) |

Expose these as a Postgres **view** (or a `security definer` function) so the client issues one
read, not five.

### Row Level Security

RLS is on for both tables. The anon key is public — it ships in the client bundle — so the
policies are the actual security boundary.

- `participants`: anon may `INSERT`. Anon may **not** `SELECT` (no scraping the name list).
- `game_results`: anon may `INSERT`. Anon may **not** `SELECT` raw rows.
- Leaderboard reads go through the aggregate view only, which exposes names and stats but no
  row-level history.

Verify these policies before the event. An anon key with permissive default policies is the one
way this app can leak anything.

---

## 7. API surface

Supabase's auto-generated REST client covers this — there is no hand-written API layer. The
logical surface is:

| Operation | Call | Returns |
| --- | --- | --- |
| Create participant | `insert into participants { name }` | `participant_id` |
| Submit result | `insert into game_results { participant_id, word, correct, time_taken_seconds }` | `game_id` |
| Read leaderboard | `select * from leaderboard_view` | All metrics for the leaderboard page |
| Fastest per word | `select * from word_records_view` | Optional, if the per-word view is shown |

This is a **two-write, one-read system** at its core. Resist growing it.

`leaderboard_view`'s DDL lives in `supabase/schema.sql` (Issue #4) and returns exactly these
snake_case columns — no `rank` column; the client assigns rank (see `lib/data.ts`, Issue #40):

| Column | Type | Notes |
| --- | --- | --- |
| `participant_id` | `uuid` | |
| `name` | `text` | |
| `score` | `numeric` | `(successful_guesses × W_A) + (speed_bonus × W_B)`, rounded |
| `successful_guesses` | `bigint` | |
| `total_games` | `bigint` | |
| `best_time_seconds` | `numeric` \| `null` | `null` until the participant has a win |

`word_records_view` is not implemented — it was always optional per this section.

`fetchLeaderboard()` (`lib/data.ts`) wraps these rows in a `LeaderboardSnapshot` — `{ rows,
source, error }` — rather than returning `LeaderboardRow[]` directly (Issue #14). `source` is
`"remote"` when the `leaderboard_view` read itself succeeded, even with zero rows, and `"local"`
when it failed and `rows` came from the on-device fallback instead. Without this, a genuinely
empty leaderboard and an unreachable one render identically — the worst failure mode on a stall
display, since nobody watching it can tell the difference. The leaderboard page uses `source` to
show a connection-status pill and a distinct empty state for the unreachable case.

Write to Supabase from **client components** using the anon key. Server-side routes would add a
hop for no benefit and break the offline-queue behavior described below.

### Offline queue

Gameplay works without network; only result submission needs it. On submit failure, push the
result to a `localStorage` queue and retry on the next successful submit and on `window.online`.
Volunteers should never have to tell someone their game didn't count.

---

## 8. Ranking logic

A single raw metric makes a bad leaderboard — either one lucky fast round dominates, or whoever
played most does. Use a composite:

```
score = (successful_guesses × W_A) + (speed_bonus × W_B)

where speed_bonus = Σ over correct rounds of max(0, ROUND_SECONDS − time_taken_seconds)

starting weights: W_A = 100, W_B = 1
```

Tune the weights during playtesting so both "played a lot and did well" and "got a few very fast
guesses" feel fairly rewarded.

Ties break on total successful guesses, then on best single time.

> **Open question.** The exact weights are not finalized. Ship them as named constants in one
> place so they can be changed without hunting through queries.

---

## 9. Route structure

```
app/
  layout.tsx              Root layout — fonts, IEEE theme, viewport metadata
  page.tsx                Landing: branding, hook, name entry
  play/page.tsx           Game shell — client state machine
  leaderboard/page.tsx    Leaderboard — mobile board, auto-refreshing (landscape deferred)
```

The whole round runs at `/play` as a **client-side state machine**, not as separate routes:

```
word-select → countdown → drawing → result → (play again) → word-select
```

Route transitions mid-round would risk unmounting the canvas and dropping the loaded model. One
route, one state variable.

Server/client split:

- `app/page.tsx` — server component shell, with the name form as a small client island.
- `app/play/page.tsx` — client component throughout. It owns canvas, timer, and inference.
- `app/leaderboard/page.tsx` — server component fetching initial data, with a client child
  subscribing to Realtime for updates. First paint is populated even if the socket is slow.

---

## 10. Participant session state

Session, not account. Held in `sessionStorage` under one key:

```ts
{ participantId: string; name: string }
```

Written after name entry, read on every subsequent round. This is what makes "Play Again" skip
name re-entry, per the PRD. It intentionally does not survive a tab close — there are no accounts.

---

## 11. Infrastructure and event-day reliability

- Deploy well before the event. Freeze changes except critical fixes.
- Only leaderboard sync is affected by internet loss, since drawing and inference are client-side.
  Results queue locally and sync when connectivity resumes.
- Assign one volunteer/technical owner to monitor the backend and leaderboard during the event.
- Serve the model from the app's own origin so it is CDN-cached and not a third-party dependency
  at stall time.

See the [Event Ops playbook](04-event-ops.md) for the full checklist.

---

## 12. State machine

```
[Landing] → [Name Entry] → [Word Selection] → [Countdown] → [Drawing + Live AI Guessing]
    → (correct guess) → [Result: Win]      → [Play Again?] → back to [Word Selection]
    → (timer expires) → [Result: No Match] → [Play Again?] → back to [Word Selection]
```

Every transition is linear. There is no branching beyond win/lose, which keeps both the
implementation and the on-device performance profile lightweight. Keep it that way.
