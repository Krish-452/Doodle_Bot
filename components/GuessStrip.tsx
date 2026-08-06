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
    <div className="h-14 w-full flex items-center justify-between rounded-xl bg-ieee-blue/5 border border-ieee-blue/20 px-4 transition-all">
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="text-xs font-bold uppercase tracking-wider text-ieee-blue shrink-0">
          AI thinks:
        </span>
        <span className="font-bold text-lg text-ink truncate capitalize">
          {topGuess ? topGuess : "Draw something..."}
        </span>
      </div>

      {topGuess && (
        <div className="flex items-center gap-2 shrink-0">
          {streak > 0 && (
            <span className="flex items-center gap-1 text-xs font-semibold text-win bg-win/10 px-2 py-0.5 rounded-full">
              <FaBolt aria-hidden="true" className="text-win" /> {streak}/2
            </span>
          )}
          {confidence !== undefined && (
            <span className="text-xs font-semibold text-ink-muted">
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
