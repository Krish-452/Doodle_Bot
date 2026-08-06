"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { ScreenShell } from "../../components/ScreenShell";
import { fetchLeaderboard } from "../../lib/data";
import { getSupabaseClient } from "../../lib/supabase";
import type { LeaderboardRow } from "../../lib/types";

interface LeaderboardClientProps {
  initialLeaderboard: LeaderboardRow[];
}

export function LeaderboardClient({ initialLeaderboard }: LeaderboardClientProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>(initialLeaderboard);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchLeaderboard();
      setLeaderboard(prev => (prev.length > 0 && data.length === 0 ? prev : data));
    } catch (e) {
      console.error("Failed to load leaderboard:", e);
    }
  }, []);

  useEffect(() => {
    // Supabase Realtime subscription on game_results inserts
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_results",
        },
        () => {
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
          }
          debounceTimer.current = setTimeout(() => {
            loadData();
          }, 500); // Debounce to prevent thrashing
        }
      )
      .subscribe();

    // Polling fallback every 10 seconds per requirements
    const interval = setInterval(loadData, 10000);

    return () => {
      clearInterval(interval);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  // Compute headline stats
  const totalGames = leaderboard.reduce((acc, row) => acc + row.gamesPlayed, 0);
  const totalWins = leaderboard.reduce((acc, row) => acc + row.successfulGuesses, 0);
  const fastestTime = leaderboard.reduce<number | null>((min, row) => {
    if (row.bestTimeSeconds !== null) {
      return min === null ? row.bestTimeSeconds : Math.min(min, row.bestTimeSeconds);
    }
    return min;
  }, null);

  return (
    <ScreenShell showLogo={true}>
      <div className="flex flex-1 flex-col max-w-2xl lg:max-w-4xl mx-auto w-full p-4 lg:p-8 space-y-6">
        {/* Title Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-3xl font-black text-ink tracking-tight flex items-center gap-2">
              <span>Leaderboard</span>
              <span>🏆</span>
            </h1>
            <p className="text-xs font-semibold text-ink-muted">IEEE Ahmedabad University Student Branch • Live Standings</p>
          </div>
          <Link
            href="/play"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-bold text-white bg-ieee-blue hover:bg-ieee-blue-dark rounded-xl shadow-sm transition-all active:scale-95 border border-ieee-blue/20"
          >
            Play Now 🎨
          </Link>
        </div>

        {/* Glanceable Headline Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-ieee-blue/5 border border-ieee-blue/20 rounded-2xl p-3 text-center space-y-1">
            <span className="text-xs font-semibold text-ink-muted uppercase block">Total Plays</span>
            <span className="text-2xl font-black text-ieee-blue">{totalGames}</span>
          </div>

          <div className="bg-win/5 border border-win/20 rounded-2xl p-3 text-center space-y-1">
            <span className="text-xs font-semibold text-ink-muted uppercase block">AI Guesses</span>
            <span className="text-2xl font-black text-win">{totalWins}</span>
          </div>

          <div className="bg-ieee-cyan/10 border border-ieee-cyan/30 rounded-2xl p-3 text-center space-y-1">
            <span className="text-xs font-semibold text-ink-muted uppercase block">Fastest</span>
            <span className="text-2xl font-black text-ink">
              {fastestTime !== null ? `${fastestTime.toFixed(1)}s` : "--"}
            </span>
          </div>
        </div>

        {/* Rankings Table / List */}
        <div className="flex-1 space-y-3">
          <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wider px-1">
            Top Participants
          </h2>

          {leaderboard.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-surface-muted/50 rounded-2xl border border-surface-muted">
              <span className="text-4xl block">🎨</span>
              <p className="text-sm font-semibold text-ink-muted">No games played yet today!</p>
              <p className="text-xs text-ink-muted">Be the first to draw and set a high score.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((row) => {
                const isTop3 = row.rank <= 3;
                const medal = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : null;

                return (
                  <div
                    key={row.participantId}
                    className={`flex items-center justify-between p-4 rounded-2xl border motion-safe:transition-all ${
                      isTop3
                        ? "bg-white border-ieee-blue/30 shadow-sm ring-1 ring-ieee-blue/10"
                        : "bg-surface-muted/40 border-surface-muted"
                    }`}
                  >
                    {/* Rank & Name */}
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                          row.rank === 1
                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                            : row.rank === 2
                            ? "bg-slate-200 text-slate-800 border border-slate-300"
                            : row.rank === 3
                            ? "bg-orange-100 text-orange-800 border border-orange-300"
                            : "bg-surface-muted text-ink-muted"
                        }`}
                      >
                        {medal ? medal : `#${row.rank}`}
                      </div>

                      <div>
                        <span className="font-bold text-base text-ink block">{row.name}</span>
                        <div className="flex items-center gap-2 text-xs text-ink-muted">
                          <span>{row.successfulGuesses} wins</span>
                          <span>•</span>
                          <span>{row.gamesPlayed} games</span>
                        </div>
                      </div>
                    </div>

                    {/* Score & Best Time */}
                    <div className="text-right">
                      <span className="font-black text-lg text-ieee-blue block">{row.score} pts</span>
                      <span className="text-xs font-semibold text-ink-muted">
                        {/* Truthiness would treat an exact 0.0s best time as "No wins yet" — compare
                            against null explicitly. The offline path can't produce 0 (clamped to a
                            0.5s minimum in app/play/page.tsx), but remote data isn't clamped. */}
                        {row.bestTimeSeconds !== null
                          ? `Best: ${row.bestTimeSeconds.toFixed(1)}s`
                          : "No wins yet"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ScreenShell>
  );
}
