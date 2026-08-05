"use client";

import React, { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  interactive?: boolean;
}

export function Card({
  children,
  selected = false,
  interactive = false,
  className = "",
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 transition-all shadow-sm ${
        interactive ? "cursor-pointer hover:border-ieee-blue hover:shadow-md active:scale-[0.99]" : ""
      } ${
        selected ? "border-ieee-blue bg-ieee-blue/5 ring-2 ring-ieee-blue/20" : "border-surface-muted"
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
