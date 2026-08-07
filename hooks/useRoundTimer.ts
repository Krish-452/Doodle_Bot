import { useState, useEffect, useRef } from "react";

/**
 * Custom hook for round countdown timer.
 * Initialized with a duration in seconds, ticks every second when active, and executes onExpire
 * exactly once when the deadline passes.
 *
 * Computed from an absolute deadline rather than decremented per tick. Backgrounding the tab (a
 * notification, a phone call, switching apps to check the QR code again) throttles setInterval —
 * browsers can delay background timers to as little as one tick a minute. A decrement-per-tick
 * timer effectively pauses while backgrounded, so a round could run far longer than
 * durationSeconds of real time before the timer caught up enough to expire it. Deadline math is
 * self-correcting on whichever tick actually fires, however late: remaining time is always
 * (deadline - now), never an accumulated count of ticks received.
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

    const deadline = Date.now() + durationSeconds * 1000;
    setTimeLeft(durationSeconds);
    let hasExpired = false;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0 && !hasExpired) {
        hasExpired = true;
        clearInterval(interval);
        onExpireRef.current();
      }
    };

    const interval = setInterval(tick, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [isActive, durationSeconds]);

  return timeLeft;
}
