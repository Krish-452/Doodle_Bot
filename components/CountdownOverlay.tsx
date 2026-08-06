"use client";

import React, { useEffect, useState } from "react";
import type { Word } from "../lib/types";

interface CountdownOverlayProps {
  word: Word;
  onComplete: () => void;
}

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ieee-blue/95 text-white p-6 backdrop-blur-md animate-fade-in">
      <div className="text-center space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-white/90">
          Get ready to draw
        </p>

        <h2 className="text-4xl font-extrabold capitalize text-white tracking-wide">
          "{word.id}"
        </h2>

        <div className="flex items-center justify-center h-40">
          <span className="text-8xl font-black text-white animate-bounce drop-shadow-lg">
            {count > 0 ? count : "GO!"}
          </span>
        </div>


        <p className="text-xs text-white/80 max-w-xs mx-auto">
          Draw clearly so the computer vision model can guess your word in real-time!
        </p>
      </div>
    </div>
  );
}
