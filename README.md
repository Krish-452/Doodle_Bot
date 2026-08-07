# DoodleBot 🤖🎨

> Browser-based AI-powered Pictionary for IEEE Ahmedabad University Student Branch — Club Carnival

DoodleBot is a zero-install, mobile-first web game where carnival attendees draw a target word on their phone and a real-time computer vision model guesses it live. Scores feed a stall-facing live leaderboard.

---

## 🚀 Features

- **Zero-Friction Onboarding**: Scan QR code → Enter Name → Start playing in < 10s.
- **Single-Route State Machine (`/play`)**: `word-select → countdown → drawing → result → word-select`. Canvas DOM & model stay loaded across rounds.
- **Real-Time AI Inference**: TensorFlow.js CNN downsamples canvas drawings to 28×28 grayscale tensors with inverted ink polarity, processing predictions every 400ms.
- **IEEE Brand Aesthetic**: Styled with IEEE Master Blue (`#00629b`), high contrast, and responsive `100dvh` layout.
- **Live Leaderboard (`/leaderboard`)**: Supabase Realtime subscription on `game_results` inserts (debounced refetch) plus a 10-second poll fallback, showing total plays, wins, and fastest times.
- **Offline Durability**: Failed result submissions queue in `localStorage` and retry on the next successful submit and on `window.online`, so a round played on flaky stall Wi-Fi still reaches the leaderboard once connectivity returns.

---

## 🛠️ Stack

- **Framework**: Next.js 16 (App Router + Turbopack)
- **Language**: TypeScript (strict)
- **Styling**: Vanilla CSS + Tailwind CSS v4 (`@theme` design tokens)
- **Inference**: TensorFlow.js (`@tensorflow/tfjs`) in-browser classification
- **Storage & Sync**: Supabase (system of record) with a `localStorage` offline retry queue as the fallback when a submission fails

---

## 📖 Development & Build

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Run TypeScript type check
npm run typecheck

# Build for production
npm run build
```

---

## 🗄️ Supabase setup

The app needs a Supabase project wired up before gameplay or the leaderboard will work end to
end — without it, name entry and score submission fall back to a device-local `localStorage`
copy (see Offline Durability above), which is enough to demo but isn't the real leaderboard.

1. **Point at a project.** Copy `.env.example` → `.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from your project's API settings.
2. **Apply the schema.** Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL
   Editor. It creates `participants` and `game_results`, `leaderboard_view`, both indexes, and
   the RLS policies (anon may `INSERT` into either table; anon may **not** `SELECT` raw rows from
   either — only from `leaderboard_view`). It's idempotent (`if not exists` / `or replace`), so
   re-running it against a project that already matches is safe.
3. **Verify it took.** Run:

   ```bash
   node scripts/check-supabase.mjs
   ```

   This is read-only against your data — every check, including the RLS probe, is engineered so
   nothing it does can persist a row (see the script's header for how). It reports exactly what's
   missing: tables, the view's column shape, whether anon can actually insert, and a few things
   (the CHECK constraints, the indexes) that only a dashboard check can confirm — those are called
   out explicitly rather than guessed at.

**Throwaway-project-only tools — never run these against the event's real project:**

- [`supabase/seed.sql`](supabase/seed.sql) — ~24 fake rows across 6 participants, for exercising
  the ranking formula and its tie-breaks against real data.
- [`scripts/verify-rls.mjs`](scripts/verify-rls.mjs) — the full anon-key insert/select acceptance
  test from issue #4. It performs real inserts the anon key can't delete, so it's gated behind
  `--i-will-clean-up` and should only ever point at a disposable project.

---

## 🎯 Issue Tracking

Resolved and in-progress work is tracked on the [GitHub issue tracker](https://github.com/Krish-452/Doodle_Bot/issues), not duplicated here — a hand-maintained list in the README goes stale the moment the code moves on.
