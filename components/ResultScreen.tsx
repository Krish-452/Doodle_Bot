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
    let isMounted = true;
    async function loadRank() {
      // Micro-delay to ensure submitResult's localStorage write has completed
      await new Promise((r) => setTimeout(r, 100));
      try {
        const board = await fetchLeaderboard();
        const userRow = board.find((r) => r.participantId === participantId);
        if (isMounted && userRow) {
          setUserRank(userRow.rank);
        }
      } catch (e) {
        console.error("Failed to load rank:", e);
      }
    }
    loadRank();
    return () => {
      isMounted = false;
    };
  }, [participantId]);

  return (
    <div className="flex flex-col items-center justify-center text-center max-w-md w-full mx-auto space-y-6 py-6 animate-fade-in">
      <div className="space-y-2">
        <div
          className={`inline-flex items-center justify-center p-4 rounded-full mb-2 ${
            won ? "bg-win/10 text-win" : "bg-timeout/10 text-timeout"
          }`}
        >
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
          <span className={`font-semibold ${won ? "text-win" : "text-timeout"}`}>
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

        <Link
          href="/leaderboard"
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold border-2 border-ieee-blue text-ieee-blue hover:bg-ieee-blue/5 active:bg-ieee-blue/10 transition-all active:scale-[0.98] shadow-sm"
        >
          View Leaderboard 🏆
        </Link>
      </div>
    </div>
  );
}

