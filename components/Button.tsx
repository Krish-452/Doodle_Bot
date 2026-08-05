"use client";

import React, { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  fullWidth?: boolean;
  isLoading?: boolean;
}

export function Button({
  children,
  variant = "primary",
  fullWidth = false,
  isLoading = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex min-h-[48px] items-center justify-center rounded-xl px-6 py-3 text-base font-semibold transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none shadow-sm";

  const variantStyles = {
    primary: "bg-ieee-blue text-white hover:bg-ieee-blue-dark active:bg-ieee-blue-dark shadow-ieee-blue/20 shadow-md",
    secondary: "bg-ieee-cyan text-ink hover:brightness-95 active:brightness-90",
    outline: "border-2 border-ieee-blue text-ieee-blue hover:bg-ieee-blue/5 active:bg-ieee-blue/10",
    ghost: "text-ink-muted hover:bg-surface-muted active:bg-surface-muted shadow-none",
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
