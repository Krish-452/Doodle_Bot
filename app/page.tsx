"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FaRobot, FaRocket } from "react-icons/fa6";
import { Button } from "../components/Button";
import { ScreenShell } from "../components/ScreenShell";
import { createParticipant } from "../lib/data";
import { isCleanName } from "../lib/profanityFilter";
import { MAX_NAME_LENGTH, SESSION_STORAGE_KEY } from "../lib/constants";

export default function LandingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Check if session already exists
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.name) {
            setName(parsed.name);
          }
        } catch (_) {}
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Please enter your name to start");
      return;
    }

    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Name must be ${MAX_NAME_LENGTH} characters or less`);
      return;
    }

    if (!isCleanName(trimmed)) {
      setError("Please choose a appropriate name");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const participantId = await createParticipant(trimmed);
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ participantId, name: trimmed })
      );
      router.push("/play");
    } catch (err) {
      console.error(err);
      setError("Failed to initialize session. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell showLogo={false} className="justify-center relative bg-gradient-to-b from-surface via-surface to-ieee-blue/5">
      <div className="flex h-dvh flex-col items-center justify-between p-6 max-w-md lg:max-w-xl mx-auto w-full text-center">
        {/* Header Branding Lockup */}
        <div className="pt-6 sm:pt-10 space-y-4">
          <div className="inline-flex items-center gap-3 glass border border-ieee-blue/20 px-4 py-2 rounded-full shadow-sm">
            <img src="/ieee-logo.svg" alt="IEEE Logo" className="h-6 w-auto object-contain" />
            <div className="text-left border-l border-ieee-blue/15 pl-2.5">
              <span className="font-bold text-ieee-blue text-xs leading-none block">IEEE Ahmedabad University</span>
              <span className="text-[10px] font-semibold text-ink-muted leading-none block mt-0.5">Student Branch • Club Carnival</span>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <h1 className="text-4xl sm:text-5xl font-black text-ink tracking-tight">
              DoodleBot{" "}
              <FaRobot
                aria-hidden="true"
                className="inline align-[-0.125em] text-ieee-blue hover:rotate-12 transition-transform"
              />
            </h1>
            <p className="text-xl sm:text-2xl font-bold text-ieee-blue text-balance">
              Draw it. Beat the AI. Top the board.
            </p>
            <p className="text-xs sm:text-sm text-ink-muted max-w-sm mx-auto">
              Test your sketch skills against our real-time computer vision AI model.
            </p>
          </div>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="w-full space-y-4 my-auto bg-white/80 backdrop-blur-sm p-6 rounded-2xl border border-ieee-blue/15 shadow-sm">
          <div className="space-y-2 text-left">
            <label htmlFor="name-input" className="text-xs font-bold text-ieee-blue uppercase tracking-wider block">
              Enter Your Name / Alias
            </label>
            <input
              id="name-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Alex"
              maxLength={MAX_NAME_LENGTH}
              className="w-full h-14 px-4 text-lg font-semibold rounded-xl border-2 border-surface-muted focus:border-ieee-blue focus:outline-none transition-all bg-white shadow-inner"
              autoFocus
            />
            {error && <p className="text-xs font-medium text-urgent text-left">{error}</p>}
          </div>

          <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
            Start Playing <FaRocket aria-hidden="true" className="inline" />
          </Button>
        </form>

        {/* Footer info */}
        <div className="pb-4 space-y-1">
          <p className="text-xs font-medium text-ink-muted flex items-center justify-center gap-1.5">
            <span>IEEE AU Student Branch</span>
            <span className="text-ieee-cyan font-bold">•</span>
            <span>Club Carnival Showcase</span>
          </p>
        </div>
      </div>
    </ScreenShell>

  );
}
