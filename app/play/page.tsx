"use client";

import { useState } from "react";

/**
 * The entire round runs here as a client-side state machine. Do not split the phases into
 * routes — a route transition risks unmounting the canvas and dropping the loaded TF.js
 * model. One route, one state variable. See docs/02-architecture.md § 9 and § 12.
 */
type RoundPhase = "word-select" | "countdown" | "drawing" | "result";

export default function PlayPage() {
  // TODO: the setter arrives with the transitions —
  // word-select → countdown → drawing → result → (play again) → word-select.
  const [phase] = useState<RoundPhase>("word-select");

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-surface-muted px-4 py-3">
        {/* TODO: small IEEE logo, the word being drawn, and the round timer. The timer shifts
            to text-urgent near zero — a colour shift, not a flash. */}
        <span className="text-sm font-semibold text-ieee-blue">DoodleBot</span>
        <span className="text-sm text-ink-muted">{phase}</span>
      </header>

      <section className="flex flex-1 items-center justify-center px-4">
        {/*
          TODO, one pass per phase:
            word-select  three large tappable cards drawn from WORD_BANK; tapping goes straight
                         to countdown, with no confirm step
            countdown    full-screen 3-2-1 with the word already visible
            drawing      canvas-surface canvas sized to devicePixelRatio, plus a fixed-height
                         "AI thinks: ___" strip so the canvas never reflows on a guess change
            result       outcome, time taken, Play Again (primary) / View Leaderboard
        */}
        <p className="text-ink-muted">Round state machine goes here.</p>
      </section>
    </main>
  );
}
