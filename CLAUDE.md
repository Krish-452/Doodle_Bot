# DoodleBot

Browser-based AI Pictionary for the IEEE Ahmedabad University Student Branch stall at Club
Carnival. Participants scan a QR code, draw a word on their phone, and a computer vision model
guesses it live. Scores feed a stall-facing leaderboard.

**Build window is 2 days.** Prefer the boring, working solution over the elegant one. Every
"while we're in here" refactor is time taken from device testing.

---

## Current state

The repo is **documentation only**. The Next.js app is not scaffolded yet. Treat everything below
as the target conventions, not a description of existing code.

```
docs/
  01-prd.md              Product requirements, scope, success metrics, open questions
  02-architecture.md     Stack, data model, inference pipeline, routes, ranking
  03-design-system.md    IEEE branding, Tailwind v4 tokens, screens, mobile canvas gotchas
  04-event-ops.md        Event-day logistics, checklists, escalation
CLAUDE.md
DoodleBot.pdf            Source document the docs were derived from
```

Read `docs/02-architecture.md` before writing any application code.

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js, **App Router** |
| Language | TypeScript, strict |
| Styling | **Tailwind CSS v4** — CSS-first, no `tailwind.config.js` |
| Inference | **TensorFlow.js**, WebGL backend, in-browser only |
| Backend + DB | **Supabase** — Postgres, auto-generated REST, Realtime |

Scaffold command, when it's time:

```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint
```

---

## Tailwind v4 — read this before writing any CSS

v4 differs from v3 in ways that matter here. Do not write v3 patterns from muscle memory.

- **No `tailwind.config.js`.** Configuration is CSS. If you find yourself creating one, stop.
- Entry is `@import "tailwindcss";` — **not** the three `@tailwind` directives.
- Design tokens go in a **single `@theme` block** in `app/globals.css`. Declaring
  `--color-ieee-blue` auto-generates `bg-ieee-blue`, `text-ieee-blue`, `border-ieee-blue`, etc.
- `@theme` generates utilities. Plain `:root` variables do **not**. Use `@theme` for anything that
  needs a utility class.
- Custom utilities use `@utility`, not `@layer utilities` + `@apply`.
- Custom variants use `@custom-variant`.
- PostCSS plugin is `@tailwindcss/postcss`.
- `@apply` inside a separate CSS file needs `@reference` to see the theme. Prefer utility classes
  in markup over `@apply` entirely.

**Never hardcode brand hexes in components.** Use `bg-ieee-blue`, not `bg-[#00629b]`. The IEEE
palette values are unverified (see below) and will likely change in one place.

---

## Next.js App Router conventions

- **Server components by default.** Add `"use client"` only where you need state, effects, or
  browser APIs.
- The entire round runs at `/play` as a **client-side state machine**
  (`word-select → countdown → drawing → result`). Do **not** split these into routes — a route
  transition risks unmounting the canvas and dropping the loaded TF.js model.
- `app/leaderboard/page.tsx` is a server component that fetches initial data, with a client child
  subscribing to Realtime. First paint must be populated even if the socket is slow.
- Metadata and viewport config go in `layout.tsx` via the `metadata`/`viewport` exports.

Target route structure:

```
app/
  layout.tsx
  page.tsx                Landing + name entry
  play/page.tsx           Game shell (client state machine)
  leaderboard/page.tsx    Stall display
lib/
  word-bank.ts            Static typed word list
  model.ts                TF.js singleton: load, warm, predict
  supabase.ts             Client factory
```

---

## Inference rules

- Load the model **once** into a module-level singleton. Never per round, never per component
  mount.
- **Warm it** with one dummy prediction at load. The first real inference is otherwise visibly slow.
- Sample the canvas every **~400ms**, and only when strokes have changed since the last sample.
- Wrap every inference in **`tf.tidy()`**. A long stall session leaks GPU memory without it.
- Serve the model from `public/model/`, not a third-party URL. It must work on flaky stall Wi-Fi.
- Win condition: target label in **top-1**, confidence **≥ 0.50**, sustained for **2 consecutive
  samples**. The two-sample rule prevents unearned wins from mid-stroke confidence spikes.
- Preprocessing polarity matters — Quick, Draw!–trained models expect **white ink on black**.
  Getting this backwards yields a model that runs fine and predicts nonsense.

**Sketch data never leaves the device.** No sketch is uploaded, logged, or persisted. This is a
product requirement, not an implementation detail.

---

## Supabase rules

- Two tables: `participants`, `game_results`. Schema in `docs/02-architecture.md § 6`.
- Writes go **directly from client components** using the anon key. Do not add API route handlers
  as a proxy — it adds a hop for no benefit and breaks the offline queue.
- **RLS is the security boundary.** The anon key is public and ships in the bundle. Anon may
  `INSERT` into both tables and `SELECT` only from the aggregate leaderboard view. Never grant
  anon raw `SELECT` on `participants`.
- Leaderboard reads hit **one view**, not five queries.
- On submit failure, queue the result in `localStorage` and retry on next submit and on
  `window.online`. Gameplay works offline; only sync needs the network.
- Session state is `sessionStorage` (`{ participantId, name }`). There are no accounts.

---

## Mobile canvas — non-negotiable

Each of these produces a broken-feeling experience if missed. Details in
`docs/03-design-system.md § 6`.

- `touch-action: none` on the canvas
- `overscroll-behavior: none` on `html, body` (stops pull-to-refresh mid-stroke)
- `-webkit-touch-callout: none` + `user-select: none` (stops iOS long-press menu)
- `100dvh`, never `100vh`
- Scale the canvas backing store by `devicePixelRatio`
- `PointerEvent` + `setPointerCapture` — not separate touch and mouse handlers

Test on **real iOS Safari and Android Chrome hardware**. Desktop devtools emulation does not
reproduce touch drawing faithfully.

---

## Scope discipline

Explicitly out of scope for v1 — do not build these, and flag it if asked to:

- Accounts, login, persistent profiles
- Native app
- Head-to-head multiplayer
- Prize fulfillment logic
- Sketch image storage
- Dark mode
- Server-side inference (documented as a fallback only; do not build preemptively)

---

## Ask before assuming

These are genuinely undecided. Raise them rather than picking a default and moving on.

| Open question | Why it matters |
| --- | --- |
| **IEEE palette hex values are unverified** | `#00629b` is the widely-used IEEE blue; the supporting palette in `docs/03-design-system.md § 2` is a working approximation. Brand compliance is a committee-review criterion. Confirm against official IEEE brand guidelines |
| **Which TF.js model, and which classes it handles reliably** | The word bank is derived *from* the model's strong classes, not chosen first. This is hour-0 work |
| **Word bank size and contents** | 40–60 is the recommendation; the real constraint is model accuracy |
| **Round timer: 90s or 120s** | Ship it configurable, decide after playtesting |
| **Ranking formula weights** | Starting point is `W_A = 100, W_B = 1`. Keep them as named constants in one place |
| **Does the leaderboard reset daily or run cumulatively?** | Changes the leaderboard query and the post-event export |
| **Is there a dedicated stall screen?** | Determines whether the landscape leaderboard layout is required or dead code |
| **Deployment host and IEEE subdomain** | HTTPS is required — QR flows expect secure origins |

---

## Conventions

- Named exports; default exports only where Next.js requires them (pages, layouts).
- Colocate components with their route (`app/play/_components/`) unless genuinely shared.
- Tunable game constants (timer length, sample interval, confidence threshold, ranking weights)
  live in **one** module. Expect all of them to change during playtesting.
- Comment the non-obvious — model input polarity, the two-sample win rule, RLS intent. Skip
  comments that restate the code.
