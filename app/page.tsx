"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
    <ScreenShell showLogo={false} className="justify-center">
      <main className="flex h-dvh flex-col items-center justify-between p-6 max-w-md mx-auto w-full text-center">
        {/* Header Branding */}
        <div className="pt-8 space-y-4">
          <div className="inline-flex items-center gap-2 bg-ieee-blue/10 px-3 py-1.5 rounded-full border border-ieee-blue/20">
            <div className="h-5 w-5 rounded-sm bg-ieee-blue text-white font-black text-xs flex items-center justify-center">
              IEEE
            </div>
            <span className="text-xs font-semibold text-ieee-blue tracking-wide">
              IEEE Ahmedabad University Student Branch
            </span>
          </div>

          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold text-ink tracking-tight">
              DoodleBot 🤖
            </h1>
            <p className="text-xl font-bold text-ieee-blue text-balance">
              Draw it. Beat the AI. Top the board.
            </p>
          </div>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="w-full space-y-4 my-auto">
          <div className="space-y-2 text-left">
            <label htmlFor="name-input" className="text-xs font-semibold text-ink-muted uppercase tracking-wider block">
              Your Name / Alias
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
              className="w-full h-14 px-4 text-lg font-semibold rounded-xl border-2 border-surface-muted focus:border-ieee-blue focus:outline-none transition-colors bg-white shadow-sm"
              autoFocus
            />
            {error && <p className="text-xs font-medium text-urgent text-left">{error}</p>}
          </div>

          <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
            Start Playing 🚀
          </Button>
        </form>

        {/* Footer info */}
        <div className="pb-4 space-y-1">
          <p className="text-xs text-ink-muted">
            IEEE Club Carnival AI Pictionary
          </p>
        </div>
      </main>
    </ScreenShell>
  );
}
