"use client";

import React from "react";
import type { Word } from "../lib/types";

interface WordSelectorProps {
  words: Word[];
  onSelect: (word: Word) => void;
  disabled?: boolean;
}

const WORD_EMOJIS: Record<string, string> = {
  easy: "🟢",
  medium: "🟡",
  hard: "🔴",
};

const CARD_COLORS = [
  "from-fun-yellow/25 to-fun-orange/15 border-fun-orange/40 hover:border-fun-orange/80 hover:shadow-fun-orange/20",
  "from-fun-pink/25 to-fun-purple/15 border-fun-pink/40 hover:border-fun-pink/80 hover:shadow-fun-pink/20",
  "from-fun-green/25 to-ieee-cyan-light/15 border-fun-green/40 hover:border-fun-green/80 hover:shadow-fun-green/20",
];

export function WordSelector({ words, onSelect, disabled = false }: WordSelectorProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 backdrop-blur-sm animate-fade-in p-4">
      <div className="flex flex-col w-full max-w-md mx-auto space-y-5 p-6 sm:p-8 bg-white rounded-3xl shadow-2xl animate-slide-up border-4 border-fun-yellow/40">

        {/* Fun header */}
        <div className="text-center space-y-2">
          <div className="text-4xl animate-wiggle">✏️</div>
          <h2 className="text-3xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Pick a word!
          </h2>
          <p className="text-sm font-semibold text-ink-muted">
            {disabled ? "⏳ Warming up the AI brain..." : "What do you want to doodle?"}
          </p>
        </div>

        {/* Word cards */}
        <div className="grid grid-cols-1 gap-3.5">
          {words.map((word, i) => (
            <button
              key={word.id}
              disabled={disabled}
              onClick={() => onSelect(word)}
              className={`flex items-center justify-between p-5 rounded-2xl border-2 bg-gradient-to-r
                transition-all duration-200 cursor-pointer shadow-sm
                hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
                disabled:opacity-50 disabled:pointer-events-none disabled:hover:scale-100
                ${CARD_COLORS[i % CARD_COLORS.length]}`}
            >
              <span
                className="text-2xl font-bold capitalize text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {word.id}
              </span>
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted bg-white/80 px-3 py-1 rounded-full border border-surface-muted">
                {WORD_EMOJIS[word.difficulty] || "⚪"} {word.difficulty}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
