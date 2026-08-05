# DoodleBot — Product Requirements

**IEEE Ahmedabad University Student Branch — Club Carnival**

> Source: `DoodleBot.pdf`, section 1. Adapted for a Next.js App Router build on a 2-day timeline.

---

## 1. Overview

DoodleBot is a browser-based, AI-powered Pictionary game. Participants scan an IEEE-branded QR
code, draw a randomly assigned word on their own phone, and watch a computer vision model try to
guess it in real time. Scores feed a live leaderboard.

The product's job is to pull footfall to the IEEE stall and hold attention there, repeatedly,
while visibly demonstrating a working AI system.

### 1.1 Problem statement

Static stalls and posters don't hold attention at a crowded carnival. IEEE needs an attraction
that:

- draws a crowd from a distance,
- gives people a reason to stay and replay, and
- actually demonstrates technical competence rather than just claiming it.

### 1.2 Objective

Build a zero-install, phone-based game where an AI guesses user sketches in real time, wrapped
entirely in IEEE branding, with a competitive leaderboard driving repeat play.

### 1.3 Target users

| Tier | Who | What they need |
| --- | --- | --- |
| Primary | Carnival attendees (students, mostly non-technical) walking past the stall | Scan → play in under 10 seconds, no install, no account |
| Secondary | IEEE members/volunteers running the stall | A leaderboard screen that pulls a crowd and needs no babysitting |
| Tertiary | IEEE committee reviewing this as a technical showcase | Evidence the system is sound, brand-compliant, low-risk to run live |

---

## 2. Goals and success metrics

### Goals

- Drive footfall and dwell time at the IEEE stall.
- Demonstrate a real, working AI/computer vision use case.
- Reinforce IEEE brand identity through repeated visual exposure.
- Be trivially easy to join (scan → play, under 10 seconds).

### Success metrics

| Metric | Target |
| --- | --- |
| Total unique participants | 500–600 footfall exposure |
| Games per participant (repeat-play signal) | 1.5–2× |
| Peak concurrent sessions handled without degradation | 20–30 |
| Leaderboard engagement | Viewed/checked by non-players (informal observation) |

Repeat play is the key signal. A high participant count with a 1.0× play ratio means the game
didn't hold anyone.

---

## 3. Out of scope (v1)

Do not build these. They are explicitly excluded:

- User accounts, login, or persistent profiles across events
- Native mobile app
- Multiplayer head-to-head drawing (same round, competing live)
- Prize/reward fulfillment logic — volunteers handle this manually
- Any drawing data retention beyond leaderboard stats (sketch images are never stored)

---

## 4. User stories

**Participant**

- I want to scan a QR code and start playing within seconds, without installing anything.
- I want to pick from a few word options so I have some control over what I draw.
- I want to see the AI's guesses update live while I draw, so the game feels responsive and alive.
- I want to know immediately whether I won, how fast, and where I rank.
- I want to replay instantly without re-scanning or re-entering my name from scratch.

**Volunteer**

- I want a leaderboard visible on a stall screen that updates live, to draw a crowd.

**Committee reviewer**

- I want to see that the system is technically sound, brand-compliant, and low-risk to run live.

---

## 5. Functional requirements

### 5.1 Entry and onboarding

- QR code deep-links to the game's landing page (mobile web, responsive).
- Landing page carries IEEE branding and a one-line explanation of the game.
- Name entry: a single text field, client-side validated — non-empty, reasonable length, basic
  profanity filter.
- Name persists for the session so replay never requires re-entry.

### 5.2 Word selection

- On starting, the system presents **3 randomly selected words** from a curated word bank.
- The word bank is scoped to sketch-recognizable, carnival-appropriate objects. See
  [Architecture § word bank](02-architecture.md#5-word-bank-design).
- Participant selects one; the selection locks in the round. No separate confirm step.

### 5.3 Countdown and drawing

- 3-second countdown before the canvas becomes active.
- Drawing canvas: single-color pen, touch/mouse freehand drawing. Undo/clear are optional for v1.
- Round timer: configurable, 90–120 seconds, visibly counting down.

### 5.4 Real-time AI guessing

- As the participant draws, the canvas is periodically sampled and passed to the recognition model.
- The model returns ranked candidate classes with confidence scores.
- The UI displays the current top guess, updating as new predictions arrive.
- The round ends immediately on a correct match, or when the timer expires.

### 5.5 Results

- On round end, show: correct/incorrect, time taken (if correct), and current leaderboard position.
- Provide a clear **Play Again** action that returns to word selection. The name persists.

### 5.6 Leaderboard

- Publicly viewable page, intended for a stall-facing screen/monitor.
- Metrics: fastest overall guess, fastest guess per word, most successful AI guesses per
  participant, total games played, overall ranking.
- Updates live or near-live. A few seconds' delay is acceptable.

### 5.7 Branding

- IEEE logo, color palette, and identity applied consistently across landing page, game screen,
  results screen, and leaderboard. See the [Design System](03-design-system.md).

---

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Comfortably support 20–30 concurrent active sessions with no perceptible lag in AI prediction updates |
| Compatibility | Works on typical Android Chrome and iOS Safari without installation |
| Reliability | Degrades gracefully on poor stall Wi-Fi — retry logic, offline-tolerant canvas capture |
| Latency | AI prediction round-trip feels live; target under ~1s per prediction cycle |
| Data handling | No sketch images retained after prediction. Only scores and metadata are persisted |
| Accessibility | Legible type and sufficient contrast per the IEEE palette, even in bright carnival lighting |

Client-side inference is what makes the performance and latency targets achievable — see
[Architecture § why client-side inference](02-architecture.md#3-why-client-side-inference).

---

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Poor/unstable stall internet | Lightweight payloads, retry/backoff, queue results locally and sync when connectivity resumes. Gameplay itself is offline-capable |
| AI model fails to recognize valid sketches | Curate the word bank to the model's known-strong classes; test extensively before the event |
| High concurrency slowing predictions | Client-side inference removes the server from the prediction loop entirely |
| Inappropriate names entered by participants | Basic client-side filtering; volunteers can moderate the leaderboard |
| Device/browser fragmentation | Test on iOS Safari and Android Chrome explicitly before the event |
| **Model sourcing overruns the 2-day budget** | Treat model validation as hour-0 work. If no usable pre-trained model is working by end of Day 1 morning, cut to a smaller word bank matched to whatever classes do work |

---

## 8. Timeline — 2-day build

The source PDF assumed a 4-week schedule. That is superseded. This is the compressed plan.

### Day 1

| Block | Work |
| --- | --- |
| Morning | Source and validate the TF.js sketch model. Confirm top-1 accuracy on hand-drawn test sketches. Derive the word bank from classes that actually work |
| Midday | Scaffold Next.js + Tailwind v4. Supabase project, schema, RLS policies |
| Afternoon | Core game flow: landing → name → word selection → countdown → canvas |
| Evening | Wire the inference loop into the canvas. Win detection |

### Day 2

| Block | Work |
| --- | --- |
| Morning | Results screen. Submit results to Supabase. Local queue + retry |
| Midday | Leaderboard route (stall layout) with live refresh |
| Afternoon | IEEE branding pass across all screens. Device testing on real iOS + Android hardware |
| Evening | Deploy, generate QR codes, smoke test on the venue network. **Freeze** |

What the compressed timeline cuts, and the risk accepted:

- **No formal load test.** Client-side inference means the server only sees two writes and one
  read per game, so the concurrency risk is low — but it is untested.
- **No volunteer dry run.** Brief volunteers with the [Ops playbook](04-event-ops.md) instead.
- **No 24–48h change freeze.** The freeze is the end of Day 2, hours before the event.

---

## 9. Open questions

These are unresolved. Do not silently pick an answer — raise them.

- **Word bank size and contents.** 40–60 words is the recommendation, but the real constraint is
  which classes the chosen model handles reliably. Finalize after model validation.
- **Round timer: 90s or 120s?** Decide after playtesting. Ship with it configurable.
- **Does the leaderboard reset per day or run cumulatively across the full carnival?**
- **Physical setup: is there a dedicated screen for the leaderboard, or is it phone-only?** This
  determines whether the landscape stall layout is required or dead code.
- **Exact ranking formula weights.** See
  [Architecture § ranking logic](02-architecture.md#8-ranking-logic).
