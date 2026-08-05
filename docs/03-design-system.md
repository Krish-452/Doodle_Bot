# DoodleBot — UX/UI Design Bible

**IEEE Ahmedabad University Student Branch — Club Carnival**

> Source: `DoodleBot.pdf`, section 3. Extended with the Tailwind v4 token implementation.

---

## 1. Design principles

- **Zero-friction entry.** QR scan to drawing in under 10 seconds, with minimal typing.
- **Feel alive.** The AI's live guessing is the emotional core of the product. The UI should make
  its "thinking" visible and satisfying to watch.
- **IEEE-first, carnival-loud.** Branding should be unmistakable when glanced at from a few feet
  away. This is a stall attraction, not just an app.
- **Replay-friendly.** Every screen makes "play again" the obvious next action.
- **Legible in any light.** Carnival lighting varies. Favor high contrast over subtle gradients.

---

## 2. Brand tokens

> ⚠️ **Verify these hex values against IEEE's official brand guidelines before the event.**
> `#00629B` is IEEE's widely-used primary blue, but the supporting palette below is a working
> approximation. Brand compliance is an explicit committee-review criterion in the
> [PRD](01-prd.md#13-target-users) — do not treat these as confirmed.

All tokens live in **one** `@theme` block in `app/globals.css`. Tailwind v4 generates the
utilities from them automatically — declaring `--color-ieee-blue` yields `bg-ieee-blue`,
`text-ieee-blue`, `border-ieee-blue`, and so on. There is no `tailwind.config.js`.

```css
@import "tailwindcss";

@theme {
  /* Brand */
  --color-ieee-blue: #00629b;
  --color-ieee-blue-dark: #00416a;
  --color-ieee-blue-light: #4a91bf;
  --color-ieee-cyan: #00b5e2;

  /* Surfaces */
  --color-surface: #ffffff;
  --color-surface-muted: #f4f6f8;
  --color-ink: #0a0a0a;
  --color-ink-muted: #5b6670;

  /* Semantic */
  --color-win: #1a7f5a;
  --color-timeout: #b4531f;
  --color-urgent: #c0392b;

  /* Type */
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;

  /* Stall-display scale — leaderboard only */
  --text-stall-hero: 7rem;
  --text-stall-hero--line-height: 0.95;
  --text-stall-row: 2.25rem;
}
```

**Use semantic names, not raw hexes, in components.** `bg-ieee-blue`, never `bg-[#00629b]`. When
the brand check comes back with corrected values, one block changes and the whole app follows.

---

## 3. Screen-by-screen breakdown

### 3.1 Landing page (post QR scan)

- IEEE logo prominent at top.
- Short, punchy one-line hook — e.g. *"Draw it. Beat the AI. Top the board."*
- Single name input + **Start** button. No other fields. No scroll on a phone screen.
- Optional: a small live counter ("412 games played today") for social proof.

Fits in one viewport at `100dvh`. If it scrolls on a small phone, it's wrong.

### 3.2 Word selection

- Three word options as large, tappable cards.
- Optional difficulty tag per word — keep it visually minimal. A small dot or label, not a
  badge-heavy UI.
- Selecting a word transitions **immediately** to countdown. No separate confirm step.

### 3.3 Countdown

- Full-screen 3-2-1, bold numerals, IEEE palette.
- The word to draw is shown clearly above or below the countdown, so the participant is already
  thinking about it before the canvas activates.

### 3.4 Drawing canvas

- The canvas takes the **majority of the screen**. This is the core interaction — don't crowd it
  with chrome.
- Persistent header: the word being drawn + the round timer, visibly counting down.
- Live AI guess as a small, clearly-labeled strip — *"AI thinks: ___"* — that updates **without
  jarring layout shifts**. Reserve its height so the canvas never reflows when the guess changes.
- Pen only is sufficient for v1. A clear-canvas icon is nice-to-have, not required.
- Timer nearing zero gets a **subtle** urgency cue — a color shift to `--color-urgent`. Not
  flashing, not strobing.

### 3.5 Results screen

- Immediate, unambiguous outcome at the top: **"AI got it!"** or **"Time's up!"** — big, and
  celebratory or encouraging either way. Never make losing feel punishing; keep the tone playful.
- Time taken (if correct) and current leaderboard rank, shown clearly.
- Two clear actions: **Play Again** (primary) and **View Leaderboard** (secondary).

### 3.6 Leaderboard (stall display)

- Designed for a larger screen viewed from a short distance — **not** a stretched mobile view.
- Top section: headline stats (fastest overall guess, most games played) as large, glanceable
  numbers.
- Ranked list below: name, score/rank, key stat.
- Auto-refreshing, no manual reload. A subtle animation on rank changes helps catch the eye of
  passersby.
- IEEE branding consistent with the rest of the app but scaled for viewing distance — larger type,
  simplified layout.

---

## 4. IEEE branding application

- **Color.** IEEE blue is the dominant brand color — headers, primary buttons, the leaderboard
  frame. Backgrounds stay neutral (white/light gray) to keep the drawing canvas legible and the AI
  guess text readable.
- **Logo.** Consistently top-left or top-center across every screen — landing, game, results,
  leaderboard. Never omitted, including on the drawing screen, where it stays small and
  unobtrusive.
- **Typography.** A clean, modern sans-serif throughout. Avoid decorative or script fonts. This is
  a technical showcase, so the type should read as precise and modern — Linear/Stripe/Apple-style
  restraint, not a "fun carnival poster" font treatment.
- **Iconography.** Minimal, line-based icons rather than flat cartoon-style ones, to keep the
  aesthetic aligned with a modern product rather than a template-feel game.

The loud, crowd-pulling quality comes from **scale and contrast**, not from decorative styling.

---

## 5. Microcopy

- Keep all copy short and confident. This is glanced at, not read.
- **Encouraging on loss:** *"So close! Try another word"* — not *"You lost"*.
- **Celebratory but restrained on wins:** *"Nailed it in 12s!"* — not a wall of exclamation marks
  and emoji.
- **Leaderboard labels self-explanatory without a legend:** *"Fastest Guess"*, not *"FG (avg, s)"*.

---

## 6. Responsive and device notes

- **Primary target: mobile portrait.** That is how it will be used at the stall.
- Canvas and touch drawing must work reliably on iOS Safari and Android Chrome. Test both
  explicitly on real hardware before the event — desktop devtools emulation does not reproduce
  touch behavior faithfully.
- The leaderboard route needs a separate **landscape, large-screen layout** sharing the same design
  language.

### Mobile web gotchas that will bite the canvas

These are not optional polish. Each one produces a broken-feeling drawing experience:

| Problem | Fix |
| --- | --- |
| Page scrolls/pans while drawing | `touch-action: none` on the canvas element |
| Pull-to-refresh fires mid-stroke | `overscroll-behavior: none` on `html, body` |
| Long-press opens a callout menu on iOS | `-webkit-touch-callout: none` + `user-select: none` |
| `100vh` overflows on mobile Safari | Use `100dvh` |
| Strokes are blurry on high-DPI phones | Scale the canvas backing store by `devicePixelRatio` and set CSS size separately |
| Double-tap zooms the page | `viewport` meta with `maximum-scale=1, user-scalable=no` on the game route |

Use `PointerEvent` (`pointerdown`/`pointermove`/`pointerup`) with `setPointerCapture`, not separate
touch and mouse handlers.

In Tailwind v4, register these as real utilities rather than arbitrary values:

```css
@utility canvas-surface {
  touch-action: none;
  user-select: none;
  -webkit-touch-callout: none;
}
```

---

## 7. Accessibility

- Maintain sufficient contrast between IEEE blue, text, and backgrounds. Target WCAG AA where
  feasible given the build timeline.
- **Tap targets** must be large enough for quick, casual use in a crowded, distracting
  environment. Minimum 44×44px; word cards should be far larger.
- **Never rely on color alone** to indicate correct/incorrect. Always pair with text and
  iconography.
- Respect `prefers-reduced-motion` for the leaderboard's rank-change animation.

### Contrast notes

`#00629b` on white is roughly 5.9:1 — passes AA for normal text. White text on `#00629b` is the
same ratio and is the safe pairing for primary buttons. `--color-ieee-cyan` (`#00b5e2`) does
**not** pass AA as a text color on white; use it for accents, fills, and large display numerals
only.

Re-check these ratios if the brand hex values change.

---

## 8. Dark mode

Out of scope for v1. The stall environment is controlled and the design commits to a light
surface, which keeps the drawing canvas legible. If it is added later, use Tailwind v4's
`@custom-variant` rather than reintroducing a config file.
