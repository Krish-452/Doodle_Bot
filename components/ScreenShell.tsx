"use client";

import React, { ReactNode } from "react";
import Link from "next/link";
import { FaTrophy } from "react-icons/fa6";

interface ScreenShellProps {
  children: ReactNode;
  showLogo?: boolean;
  className?: string;
}

export function ScreenShell({ children, showLogo = true, className = "" }: ScreenShellProps) {
  return (
    <div className={`flex min-h-dvh flex-col bg-surface text-ink antialiased ${className}`}>
      {showLogo && (
        <header className="flex items-center justify-between border-b-2 border-fun-yellow/30 px-3 sm:px-8 py-2.5 bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-sm gap-2">
          <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
            <img
              src="/ieee-logo.png"
              alt="IEEE Logo"
              className="h-7 sm:h-9 w-auto shrink-0 object-contain transition-transform group-hover:scale-105"
            />
            <span
              className="font-bold text-ink text-base sm:text-xl leading-none tracking-tight shrink-0 group-hover:text-ieee-blue transition-colors"
              style={{ fontFamily: "var(--font-display)" }}
            >
              DoodleBot 🤖
            </span>
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-fun-orange hover:text-fun-coral transition-all px-3 py-1.5 rounded-xl bg-fun-yellow/15 hover:bg-fun-yellow/25 border-2 border-fun-yellow/30 shrink-0 whitespace-nowrap"
          >
            <span>Leaderboard</span>
          </Link>
        </header>
      )}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
