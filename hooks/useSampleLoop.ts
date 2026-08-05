import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { CanvasHandle, Word, GuessState } from "../lib/types";
import { predict } from "../lib/model";
import { evaluateGuess } from "../lib/guess";
import { SAMPLE_INTERVAL_MS } from "../lib/constants";

interface UseSampleLoopOptions {
  isActive: boolean;
  canvasRef: RefObject<CanvasHandle | null>;
  selectedWord: Word | null;
  guessStateRef: RefObject<GuessState>;
  onGuessUpdate: (nextState: GuessState, topConfidence?: number) => void;
  onWin: () => void;
}

/**
 * Custom hook for interval-based stroke-dirty sampling loop during drawing phase.
 * Features idle optimization (skips clean canvas) and concurrency control (skips ticks if predict is pending).
 */
export function useSampleLoop({
  isActive,
  canvasRef,
  selectedWord,
  guessStateRef,
  onGuessUpdate,
  onWin,
}: UseSampleLoopOptions) {
  const isPredictingRef = useRef<boolean>(false);
  const onGuessUpdateRef = useRef(onGuessUpdate);
  const onWinRef = useRef(onWin);

  useEffect(() => {
    onGuessUpdateRef.current = onGuessUpdate;
    onWinRef.current = onWin;
  }, [onGuessUpdate, onWin]);

  useEffect(() => {
    if (!isActive || !selectedWord) {
      isPredictingRef.current = false;
      return;
    }

    const interval = setInterval(async () => {
      // Concurrency Control: skip if a prediction is already in flight
      if (isPredictingRef.current || !canvasRef.current) return;

      // Idle Optimization: skip if canvas strokes have not changed
      if (!canvasRef.current.consumeDirty()) return;

      isPredictingRef.current = true;
      try {
        const snapshot = canvasRef.current.getSnapshot();
        if (snapshot) {
          const predictions = await predict(snapshot);
          if (predictions && predictions.length > 0) {
            const topConfidence = predictions[0].confidence;
            const currentGuessState = guessStateRef.current;
            const nextState = evaluateGuess(predictions, selectedWord, currentGuessState);

            onGuessUpdateRef.current(nextState, topConfidence);

            if (nextState.won) {
              onWinRef.current();
            }
          }
        }
      } catch (err) {
        console.error("Sampling error:", err);
      } finally {
        isPredictingRef.current = false;
      }
    }, SAMPLE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      isPredictingRef.current = false;
    };
  }, [isActive, selectedWord, canvasRef, guessStateRef]);
}
