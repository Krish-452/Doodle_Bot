"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { FaBullseye, FaHourglassEnd, FaPalette, FaTrophy } from "react-icons/fa6";
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
        const userRow = board.rows.find((r) => r.participantId === participantId);
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

  // Confetti emojis for win
  const confettiEmojis = ["🎉", "⭐", "🎊", "✨", "🌟", "💫", "🎯", "🔥"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm animate-fade-in p-4">
      <div className="relative flex flex-col items-center text-center max-w-md w-full mx-auto bg-white rounded-3xl shadow-2xl p-6 sm:p-8 animate-slide-up overflow-hidden">

        {/* Confetti particles on win */}
        {won && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {confettiEmojis.map((emoji, i) => (
              <span
                key={i}
                className="absolute text-2xl"
                style={{
                  left: `${10 + i * 12}%`,
                  top: `-10%`,
                  animation: `confettiFall ${1.5 + Math.random()}s ease-in ${i * 0.15}s forwards`,
                }}
              >
                {emoji}
              </span>
            ))}
          </div>
        )}

        {/* Result icon */}
        <div className="space-y-3 relative z-10">
          <div className="animate-scale-pop">
            {won ? (
              <FaBullseye aria-hidden="true" className="text-7xl inline-block text-win" />
            ) : (
              <FaHourglassEnd aria-hidden="true" className="text-7xl inline-block text-timeout" />
            )}
          </div>

          <h2
            className="text-3xl font-bold"
            style={{ fontFamily: "var(--font-display)", color: won ? "var(--color-win)" : "var(--color-timeout)" }}
          >
            {won
              ? `Nailed it!${timeTakenSeconds ? ` ${timeTakenSeconds.toFixed(1)}s` : ""}`
              : "Times up!"}
          </h2>

          <p className="text-sm text-ink-muted">
            {won
              ? <>The AI got your <strong className="capitalize text-ink">&quot;{word}&quot;</strong> doodle! 🤖✨</>
              : <>The AI couldn&apos;t crack your <strong className="capitalize text-ink">&quot;{word}&quot;</strong>. Better luck next time!</>}
          </p>
        </div>

        {/* Celebration row on win */}
        {won && (
          <div className="flex items-center justify-center gap-3 text-2xl py-2">
            {["🎉", "✨", "🎊", "⭐", "🎉"].map((e, i) => (
              <span key={i} className="animate-bounce" style={{ animationDelay: `${i * 80}ms` }}>{e}</span>
            ))}
          </div>
        )}

        {/* Quick stats — compact and fun */}
        <div className="w-full grid grid-cols-3 gap-3 py-4 relative z-10">
          <div className="flex flex-col items-center p-3 rounded-2xl bg-fun-yellow/10 border border-fun-yellow/20">
            <span className="text-lg">👤</span>
            <span className="text-xs text-ink-muted mt-1">Player</span>
            <span className="text-sm font-bold text-ink truncate max-w-full">{participantName}</span>
          </div>
          <div className={`flex flex-col items-center p-3 rounded-2xl ${won ? "bg-fun-green/10 border border-fun-green/20" : "bg-fun-coral/10 border border-fun-coral/20"}`}>
            <span className="text-lg">{won ? "⚡" : "⏱️"}</span>
            <span className="text-xs text-ink-muted mt-1">Time</span>
            <span className={`text-sm font-bold ${won ? "text-win" : "text-timeout"}`}>
              {timeTakenSeconds ? `${timeTakenSeconds.toFixed(1)}s` : "Timed Out"}
            </span>
          </div>
          <div className="flex flex-col items-center p-3 rounded-2xl bg-fun-purple/10 border border-fun-purple/20">
            <span className="text-lg">🏆</span>
            <span className="text-xs text-ink-muted mt-1">Rank</span>
            <span className="text-sm font-bold text-ieee-blue">
              {userRank ? `#${userRank}` : "--"}
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col w-full space-y-3 relative z-10">
          <Button variant="primary" fullWidth onClick={onPlayAgain}>
            Play Again
          </Button>

          <Link
            href="/leaderboard"
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold border-2 border-ieee-blue text-ieee-blue hover:bg-ieee-blue/5 active:bg-ieee-blue/10 transition-all active:scale-[0.98] shadow-sm"
          >
            View Leaderboard
          </Link>
        </div>
      </div>
    </div>
  );
}
