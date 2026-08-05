"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface UseRoundTimerOptions {
  durationSeconds: number;
  isActive: boolean;
  onTimeUp: () => void;
}

export function useRoundTimer({
  durationSeconds,
  isActive,
  onTimeUp,
}: UseRoundTimerOptions) {
  const [timeLeft, setTimeLeft] = useState<number>(durationSeconds);
  const endTimeRef = useRef<number | null>(null);
  const onTimeUpRef = useRef(onTimeUp);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  const syncTime = useCallback(() => {
    if (!endTimeRef.current) return;
    const remainingMs = endTimeRef.current - Date.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    setTimeLeft(remainingSec);

    if (remainingSec <= 0) {
      onTimeUpRef.current();
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      endTimeRef.current = null;
      setTimeLeft(durationSeconds);
      return;
    }

    endTimeRef.current = Date.now() + durationSeconds * 1000;
    setTimeLeft(durationSeconds);

    const interval = setInterval(() => {
      syncTime();
    }, 250);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        syncTime();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isActive, durationSeconds, syncTime]);

  return timeLeft;
}
