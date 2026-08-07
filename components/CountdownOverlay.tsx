"use client";

import React, { useEffect, useState } from "react";
import type { Word } from "../lib/types";

interface CountdownOverlayProps {
  word: Word;
  onComplete: () => void;
}

const BG_GRADIENTS = [
  "from-fun-coral via-fun-pink to-fun-purple",
  "from-fun-orange via-fun-yellow to-fun-green",
  "from-fun-purple via-ieee-blue to-ieee-cyan",
];

export function CountdownOverlay({ word, onComplete }: CountdownOverlayProps) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count < 0) {
      onComplete();
      return;
    }

    if (count === 0) {
      const goTimer = setTimeout(() => {
        onComplete();
      }, 500);
      return () => clearTimeout(goTimer);
    }

    const timer = setInterval(() => {
      setCount((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [count, onComplete]);

  // SVG ring constants: radius=45, circumference = 2*PI*45 ≈ 283
  const circumference = 283;
  const ringProgress = count > 0 ? ((3 - count) / 3) * circumference : circumference;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br ${
        BG_GRADIENTS[count % BG_GRADIENTS.length]
      } text-white p-6 animate-fade-in transition-all duration-500`}
    >
      <div className="text-center space-y-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-white/90">
          🖊️ Get ready to draw!
        </p>

        <h2
          className="text-5xl font-bold capitalize text-white tracking-wide drop-shadow-lg"
          style={{ fontFamily: "var(--font-display)" }}
        >
          &quot;{word.id}&quot;
        </h2>

        {/* Countdown with SVG ring */}
        <div className="relative flex items-center justify-center h-48 w-48 mx-auto">
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="5"
            />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="white"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              style={{
                animation: "countdownRing 3.5s linear forwards",
                filter: "drop-shadow(0 0 8px rgba(255,255,255,0.5))",
              }}
            />
          </svg>
          <span
            className="text-8xl font-black text-white animate-scale-pop drop-shadow-lg"
            style={{ fontFamily: "var(--font-display)" }}
            key={count}
          >
            {count > 0 ? count : "GO!"}
          </span>
        </div>

        <p className="text-sm text-white/80 max-w-xs mx-auto font-medium">
          Draw fast & clear — the AI is watching! 🤖
        </p>
      </div>
    </div>
  );
}
