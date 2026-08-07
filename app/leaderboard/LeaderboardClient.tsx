"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { FaCircle, FaMedal, FaPalette, FaTrophy } from "react-icons/fa6";
import { ScreenShell } from "../../components/ScreenShell";
import { fetchLeaderboard } from "../../lib/data";
import { getSupabaseClient } from "../../lib/supabase";
import type { LeaderboardSnapshot } from "../../lib/types";

interface LeaderboardClientProps {
  initialSnapshot: LeaderboardSnapshot;
}

/** Connection status shown by the pill next to the title. Derived, not stored — see below. */
type ConnectionStatus = "live" | "reconnecting" | "offline";

export function LeaderboardClient({ initialSnapshot }: LeaderboardClientProps) {
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot>(initialSnapshot);
  // Assume online until a browser 'offline' event says otherwise. Defaulting to true (rather
  // than reading navigator.onLine during render) keeps the server and client's first render
  // identical — navigator doesn't exist on the server, and reading it only in an effect avoids a
  // hydration mismatch.
  const [isOnline, setIsOnline] = useState(true);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const loadData = useCallback(async () => {
    // fetchLeaderboard() never throws (see lib/data.ts) — it always resolves to a snapshot,
    // remote or local. Always render the latest one. The previous version kept stale rows
    // whenever a refetch returned zero ("prev.length > 0 && data.length === 0 ? prev : data"),
    // which froze the board on the last good read instead of showing the real state — exactly
    // what #14 rules out ("a frozen board is worse than a slow one"). The status pill and the
    // remote/local empty-state split below are what make a genuine drop visible instead.
    const data = await fetchLeaderboard();
    setSnapshot(data);
  }, []);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    // Supabase Realtime subscription on game_results inserts.
    //
    // Under supabase/schema.sql's RLS policies this can never actually deliver an event: anon
    // has no SELECT policy on game_results, and postgres_changes enforces RLS on the subscribing
    // role (documented at schema.sql:113-119, deliberately — do not add a SELECT policy just to
    // make this fire). Left wired up anyway: it's harmless, and it starts working for free if
    // that policy decision is ever revisited. The 10s poll below is what actually keeps the
    // board live.
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

  const leaderboard = snapshot.rows;
  const status: ConnectionStatus =
    snapshot.source === "remote" ? "live" : isOnline ? "reconnecting" : "offline";

  // Compute headline stats
  const totalGames = leaderboard.reduce((acc, row) => acc + row.gamesPlayed, 0);
  const totalWins = leaderboard.reduce((acc, row) => acc + row.successfulGuesses, 0);
  const fastestTime = leaderboard.reduce<number | null>((min, row) => {
    if (row.bestTimeSeconds !== null) {
      return min === null ? row.bestTimeSeconds : Math.min(min, row.bestTimeSeconds);
    }
    return min;
  }, null);

  // Full literal class strings per status, not a template built from `status` — Tailwind v4's
  // scanner statically greps source for class names, so `bg-${token}/10` would never generate
  // the CSS (the string only exists at runtime). See CLAUDE.md's Tailwind v4 section.
  const STATUS_COPY: Record<ConnectionStatus, { label: string; pillClass: string }> = {
    live: {
      label: "Live",
      pillClass: "bg-win/10 border-win/20 text-win",
    },
    reconnecting: {
      label: "Reconnecting…",
      pillClass: "bg-ink-muted/10 border-ink-muted/20 text-ink-muted",
    },
    offline: {
      label: "Offline",
      pillClass: "bg-urgent/10 border-urgent/20 text-urgent",
    },
  };
  const statusCopy = STATUS_COPY[status];

  return (
    <ScreenShell showLogo={true}>
      <div className="flex flex-1 flex-col max-w-2xl lg:max-w-4xl mx-auto w-full p-4 lg:p-8 space-y-6">
        {/* Title Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <div className="space-y-1">
            <h1 className="text-3xl font-black text-ink tracking-tight flex items-center flex-wrap gap-2">
              <span>Leaderboard</span>
              <FaTrophy aria-hidden="true" className="text-medal-gold" />
              {/* Connection status pill (Issue #14). "Live" only means the last read reached
                  Supabase, not that the Realtime socket is delivering events — see the
                  subscription comment below for why that channel can never fire under RLS. */}
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border motion-safe:transition-colors ${statusCopy.pillClass}`}
                role="status"
              >
                <FaCircle
                  aria-hidden="true"
                  className={`text-[6px] ${status === "reconnecting" ? "motion-safe:animate-pulse" : ""}`}
                />
                {statusCopy.label}
              </span>
            </h1>
            <p className="text-xs font-semibold text-ink-muted">Live Standings</p>
          </div>
          <Link
            href="/play"
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-bold text-white bg-ieee-blue hover:bg-ieee-blue-dark rounded-xl shadow-sm transition-all active:scale-95 border border-ieee-blue/20 shrink-0 whitespace-nowrap self-start sm:self-auto"
          >
            Play Now
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

          {leaderboard.length === 0 && snapshot.source === "local" ? (
            // Distinct from the genuinely-empty state below on purpose (Issue #14): this is the
            // local fallback, not a confirmed empty board. On a stall display, showing the same
            // "no games played" copy here would read as a healthy board that just hasn't seen a
            // play yet, when it may in fact be disconnected from Supabase entirely.
            <div className="py-12 text-center space-y-3 bg-urgent/5 rounded-2xl border border-urgent/20">
              <FaCircle aria-hidden="true" className="text-2xl text-urgent" />
              <p className="text-sm font-semibold text-ink">Can&apos;t reach the leaderboard</p>
              <p className="text-xs text-ink-muted">Showing this device&apos;s local results. Retrying every 10s.</p>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-surface-muted/50 rounded-2xl border border-surface-muted">
              <FaPalette aria-hidden="true" className="text-4xl text-ieee-cyan" />
              <p className="text-sm font-semibold text-ink-muted">No games played yet today!</p>
              <p className="text-xs text-ink-muted">Be the first to draw and set a high score.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((row) => {
                const isTop3 = row.rank <= 3;
                const medalColor =
                  row.rank === 1
                    ? "text-medal-gold"
                    : row.rank === 2
                    ? "text-medal-silver"
                    : row.rank === 3
                    ? "text-medal-bronze"
                    : null;

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
                        {medalColor ? (
                          <>
                            {/* The medal icon alone doesn't say WHICH medal to a screen reader,
                                and previously the numeric rank was dropped entirely for top 3 —
                                colour + icon shape was the only signal. Kept visually (that's the
                                point of a medal), restored for assistive tech via sr-only text. */}
                            <FaMedal aria-hidden="true" className={medalColor} />
                            <span className="sr-only">Rank #{row.rank}</span>
                          </>
                        ) : (
                          `#${row.rank}`
                        )}
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
