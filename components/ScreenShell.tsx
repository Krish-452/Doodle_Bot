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
        <header className="flex items-center justify-between border-b border-surface-muted px-4 lg:px-8 py-3 bg-white/90 backdrop-blur-md sticky top-0 z-30 shadow-xs">
          <Link href="/" className="flex items-center gap-3 group">
            <img
              src="/ieee-logo.svg"
              alt="IEEE Logo"
              className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
            />
            <div className="flex flex-col">
              <span className="font-extrabold text-ieee-blue text-base leading-none tracking-tight block group-hover:text-ieee-blue-dark transition-colors">
                DoodleBot
              </span>
              <span className="text-[11px] font-semibold text-ink-muted leading-tight block mt-0.5">
                IEEE Ahmedabad University <span className="text-ieee-cyan font-bold">•</span> Student Branch
              </span>
            </div>
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-ieee-blue hover:text-ieee-blue-dark transition-all px-3 py-1.5 rounded-lg bg-ieee-blue/5 hover:bg-ieee-blue/10 border border-ieee-blue/15 shadow-xs"
          >
            <span>Leaderboard</span>
            <span className="text-sm">🏆</span>
          </Link>
        </header>
      )}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
