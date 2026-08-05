"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "./Button";
import { fetchLeaderboard } from "../lib/data";

interface ResultScreenProps {
  won: boolean;
  word: string;
  timeTakenSeconds: number | null;
  participantId: string;
  participantName: string;
  onPlayAgain: () => void;
}

export function ResultScreen({
  won,
  word,
  timeTakenSeconds,
  participantId,
  participantName,
  onPlayAgain,
}: ResultScreenProps) {
  const [userRank, setUserRank] = useState<number | null>(null);

  useEffect(() => {
    async function loadRank() {
      try {
        const board = await fetchLeaderboard();
        const userRow = board.find((r) => r.participantId === participantId);
        if (userRow) {
          setUserRank(userRow.rank);
        }
      } catch (e) {
        console.error("Failed to load rank:", e);
      }
    }
    loadRank();
  }, [participantId]);

  return (
    <div className="flex flex-col items-center justify-center text-center max-w-md w-full mx-auto space-y-6 py-6 animate-fade-in">
      <div className="space-y-2">
        <div className="inline-flex items-center justify-center p-4 rounded-full bg-surface-muted mb-2">
          {won ? (
            <span className="text-6xl">🎯</span>
          ) : (
            <span className="text-6xl">⏳</span>
          )}
        </div>

        <h2 className="text-3xl font-extrabold text-ink">
          {won ? `Nailed it${timeTakenSeconds ? ` in ${timeTakenSeconds.toFixed(1)}s!` : "!"}` : "So close!"}
        </h2>

        <p className="text-sm font-medium text-ink-muted">
          {won
            ? `The AI successfully recognized your "${word}" sketch!`
            : `Time ran out before the AI could guess "${word}". Try another word!`}
        </p>
      </div>

      {/* Summary Card */}
      <div className="w-full rounded-2xl bg-surface-muted/60 p-5 border border-surface-muted space-y-3">
        <div className="flex items-center justify-between text-sm py-1 border-b border-surface-muted">
          <span className="text-ink-muted">Participant</span>
          <span className="font-semibold text-ink">{participantName}</span>
        </div>
        <div className="flex items-center justify-between text-sm py-1 border-b border-surface-muted">
          <span className="text-ink-muted">Word</span>
          <span className="font-semibold capitalize text-ink">{word}</span>
        </div>
        <div className="flex items-center justify-between text-sm py-1 border-b border-surface-muted">
          <span className="text-ink-muted">Time</span>
          <span className="font-semibold text-ink">
            {timeTakenSeconds ? `${timeTakenSeconds.toFixed(1)}s` : "Timed Out"}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm py-1">
          <span className="text-ink-muted">Leaderboard Rank</span>
          <span className="font-bold text-ieee-blue">
            {userRank ? `#${userRank}` : "--"}
          </span>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col w-full space-y-3 pt-2">
        <Button variant="primary" fullWidth onClick={onPlayAgain}>
          Play Again 🎨
        </Button>

        <Link href="/leaderboard" className="w-full">
          <Button variant="outline" fullWidth>
            View Leaderboard 🏆
          </Button>
        </Link>
      </div>
    </div>
  );
}
