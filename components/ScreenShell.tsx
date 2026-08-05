"use client";

import React, { ReactNode } from "react";
import Link from "next/link";

interface ScreenShellProps {
  children: ReactNode;
  showLogo?: boolean;
  className?: string;
}

export function ScreenShell({ children, showLogo = true, className = "" }: ScreenShellProps) {
  return (
    <div className={`flex min-h-dvh flex-col bg-surface text-ink antialiased ${className}`}>
      {showLogo && (
        <header className="flex items-center justify-between border-b border-surface-muted px-4 py-3 bg-white/80 backdrop-blur-sm sticky top-0 z-30">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ieee-blue text-white font-bold text-sm shadow-sm">
              IEEE
            </div>
            <div>
              <span className="font-bold text-ieee-blue text-base leading-none block">DoodleBot</span>
              <span className="text-[10px] text-ink-muted leading-none block">AU Student Branch</span>
            </div>
          </Link>
          <Link
            href="/leaderboard"
            className="text-xs font-semibold text-ieee-blue hover:text-ieee-blue-dark transition-colors px-2 py-1 rounded-md hover:bg-surface-muted"
          >
            Leaderboard 🏆
          </Link>
        </header>
      )}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
