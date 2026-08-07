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
        <header className="flex items-center justify-between border-b-2 border-fun-yellow/30 px-4 lg:px-8 py-3 bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-sm">
          <Link href="/" className="flex items-center gap-2.5 group min-w-0">
            <img
              src="/ieee-logo.svg"
              alt="IEEE Logo"
              className="h-8 w-auto shrink-0 object-contain transition-transform group-hover:scale-105"
            />
            <div className="flex flex-col min-w-0">
              <span
                className="font-bold text-ink text-lg leading-none tracking-tight block group-hover:text-ieee-blue transition-colors truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                DoodleBot <span className="inline-block group-hover:animate-wiggle">🤖</span>
              </span>
              <span className="text-[11px] font-semibold text-ink-muted leading-tight mt-0.5 hidden sm:block">
                IEEE Ahmedabad University <span className="text-fun-orange font-bold">•</span> Student Branch
              </span>
            </div>
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-fun-orange hover:text-fun-coral transition-all px-3 py-1.5 rounded-xl bg-fun-yellow/15 hover:bg-fun-yellow/25 border-2 border-fun-yellow/30 shrink-0"
          >
            <span className="hidden sm:inline">Leaderboard</span>
            <FaTrophy aria-hidden="true" className="text-sm" />
          </Link>
        </header>
      )}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
