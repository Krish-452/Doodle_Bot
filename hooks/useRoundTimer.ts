import { useState, useEffect, useRef } from "react";

/**
 * Custom hook for round countdown timer.
 * Initialized with a duration in seconds, decrements every second when active,
 * and executes onExpire exactly once when reaching zero.
 */
export function useRoundTimer(
  isActive: boolean,
  durationSeconds: number,
  onExpire: () => void
): number {
  const [timeLeft, setTimeLeft] = useState<number>(durationSeconds);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!isActive) {
      setTimeLeft(durationSeconds);
      return;
    }

    setTimeLeft(durationSeconds);
    const hasExpiredRef = { current: false };

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!hasExpiredRef.current) {
            hasExpiredRef.current = true;
            onExpireRef.current();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [isActive, durationSeconds]);

  return timeLeft;
}
