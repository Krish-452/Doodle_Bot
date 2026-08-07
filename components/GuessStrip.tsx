"use client";

import React from "react";
import { FaBolt } from "react-icons/fa6";

interface GuessStripProps {
  topGuess: string | null;
  confidence?: number;
  streak?: number;
}

export function GuessStrip({ topGuess, confidence, streak = 0 }: GuessStripProps) {
  return (
    <div className={`min-h-[56px] w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-all border-2 ${
      topGuess
        ? "bg-gradient-to-r from-fun-pink/10 to-fun-purple/10 border-fun-pink/25"
        : "bg-surface-muted/50 border-surface-muted"
    }`}>
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="text-lg shrink-0">{topGuess ? "🤖" : "✏️"}</span>
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
            AI thinks...
          </span>
          <span
            className="font-bold text-lg text-ink truncate capitalize"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {topGuess ? topGuess : "Start doodling!"}
          </span>
        </div>
      </div>

      {topGuess && (
        <div className="flex items-center gap-2 shrink-0">
          {streak > 0 && (
            <span className="flex items-center gap-1 text-xs font-bold text-fun-orange bg-fun-orange/10 px-2.5 py-1 rounded-full border border-fun-orange/20">
              <FaBolt aria-hidden="true" /> {streak}/2
            </span>
          )}
          {confidence !== undefined && (
            <span className="text-sm font-bold text-fun-purple">
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
