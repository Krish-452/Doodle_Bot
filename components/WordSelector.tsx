"use client";

import React from "react";
import type { Word } from "../lib/types";
import { Card } from "./Card";

interface WordSelectorProps {
  words: Word[];
  onSelect: (word: Word) => void;
}

export function WordSelector({ words, onSelect }: WordSelectorProps) {
  const getDifficultyColor = (diff: string) => {
    switch (diff) {
      case "easy":
        return "bg-win/10 text-win border-win/20";
      case "medium":
        return "bg-ieee-blue/10 text-ieee-blue border-ieee-blue/20";
      case "hard":
        return "bg-urgent/10 text-urgent border-urgent/20";
      default:
        return "bg-surface-muted text-ink-muted";
    }
  };

  return (
    <div className="flex flex-col w-full max-w-md mx-auto space-y-4 py-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold text-ink">Choose a Word</h2>
        <p className="text-sm text-ink-muted">Tap any card to lock in your choice</p>
      </div>

      <div className="grid grid-cols-1 gap-4 pt-2">
        {words.map((word) => (
          <Card
            key={word.id}
            interactive
            onClick={() => onSelect(word)}
            className="flex items-center justify-between p-6 hover:border-ieee-blue group transition-all"
          >
            <span className="text-2xl font-bold capitalize text-ink group-hover:text-ieee-blue transition-colors">
              {word.id}
            </span>
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider border ${getDifficultyColor(
                word.difficulty
              )}`}
            >
              {word.difficulty}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
