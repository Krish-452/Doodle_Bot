"use client";

import { useEffect, useRef } from "react";
import { predict } from "../lib/model";
import { evaluateGuess } from "../lib/guess";
import type { CanvasHandle, GuessState, Word } from "../lib/types";
import { SAMPLE_INTERVAL_MS } from "../lib/constants";

interface UseSampleLoopOptions {
  isActive: boolean;
  selectedWord: Word | null;
  canvasRef: React.RefObject<CanvasHandle | null>;
  guessStateRef: React.MutableRefObject<GuessState>;
  onGuessUpdated: (nextState: GuessState, confidence?: number) => void;
  onWin: () => void;
}

export function useSampleLoop({
  isActive,
  selectedWord,
  canvasRef,
  guessStateRef,
  onGuessUpdated,
  onWin,
}: UseSampleLoopOptions) {
  const isEvaluatingRef = useRef(false);

  useEffect(() => {
    if (!isActive || !selectedWord) return;

    const interval = setInterval(async () => {
      if (isEvaluatingRef.current || document.hidden || !canvasRef.current) return;

      if (!canvasRef.current.consumeDirty()) return;

      isEvaluatingRef.current = true;
      try {
        const snapshot = canvasRef.current.getSnapshot();
        if (snapshot) {
          const startTime = performance.now();
          const predictions = await predict(snapshot);
          const duration = performance.now() - startTime;
          console.log(`[Telemetry] Model inference duration: ${duration.toFixed(2)}ms`);

          if (predictions && predictions.length > 0) {
            const topConf = predictions[0].confidence;
            const nextState = evaluateGuess(predictions, selectedWord, guessStateRef.current);
            guessStateRef.current = nextState;
            onGuessUpdated(nextState, topConf);

            if (nextState.won) {
              onWin();
            }
          }
        }
      } catch (err) {
        console.error("Sampling error:", err);
      } finally {
        isEvaluatingRef.current = false;
      }
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isActive, selectedWord, canvasRef, guessStateRef, onGuessUpdated, onWin]);
}
