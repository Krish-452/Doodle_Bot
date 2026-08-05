"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScreenShell } from "../../components/ScreenShell";
import { WordSelector } from "../../components/WordSelector";
import { CountdownOverlay } from "../../components/CountdownOverlay";
import { DrawingCanvas } from "../../components/DrawingCanvas";
import { GuessStrip } from "../../components/GuessStrip";
import { ResultScreen } from "../../components/ResultScreen";
import { pickThreeWords } from "../../lib/word-bank";
import { loadModel, predict, isModelReady } from "../../lib/model";
import { evaluateGuess, INITIAL_GUESS_STATE } from "../../lib/guess";
import { submitResult } from "../../lib/data";
import type { CanvasHandle, GuessState, Word } from "../../lib/types";
import {
  ROUND_SECONDS,
  SAMPLE_INTERVAL_MS,
  SESSION_STORAGE_KEY,
} from "../../lib/constants";

type RoundPhase = "word-select" | "countdown" | "drawing" | "result";

export default function PlayPage() {
  const router = useRouter();

  // Session state
  const [session, setSession] = useState<{ participantId: string; name: string } | null>(null);

  // State Machine
  const [phase, setPhase] = useState<RoundPhase>("word-select");
  const [wordChoices, setWordChoices] = useState<Word[]>([]);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);

  // Game & Timer state
  const [timeLeft, setTimeLeft] = useState<number>(ROUND_SECONDS);
  const [guessState, setGuessState] = useState<GuessState>(INITIAL_GUESS_STATE);
  const [topConfidence, setTopConfidence] = useState<number | undefined>(undefined);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(true);

  // Refs
  const canvasRef = useRef<CanvasHandle | null>(null);
  const roundStartTimeRef = useRef<number | null>(null);
  const guessStateRef = useRef<GuessState>(INITIAL_GUESS_STATE);
  const isEvaluatingRef = useRef<boolean>(false);

  // 1. Session check & Model loading on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      router.replace("/");
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed.participantId || !parsed.name) {
        router.replace("/");
        return;
      }
      setSession(parsed);
    } catch (_) {
      router.replace("/");
      return;
    }

    // Load word choices
    setWordChoices(pickThreeWords());

    // Preload model once
    loadModel().then(() => {
      setIsModelLoading(false);
    });
  }, [router]);

  // 2. Select Word action -> Go to countdown
  const handleSelectWord = (word: Word) => {
    setSelectedWord(word);
    setPhase("countdown");
  };

  // 3. Countdown completed -> Start drawing phase
  const handleCountdownComplete = () => {
    setPhase("drawing");
    setTimeLeft(ROUND_SECONDS);
    setGuessState(INITIAL_GUESS_STATE);
    guessStateRef.current = INITIAL_GUESS_STATE;
    setTopConfidence(undefined);
    roundStartTimeRef.current = Date.now();

    if (canvasRef.current) {
      canvasRef.current.clear();
    }
  };

  // 4. End round helper
  const handleEndRound = useCallback(
    async (won: boolean) => {
      setPhase("result");

      const elapsedMs = roundStartTimeRef.current
        ? Date.now() - roundStartTimeRef.current
        : 0;
      const elapsedSec = won ? Math.max(0.5, Number((elapsedMs / 1000).toFixed(1))) : null;

      if (session && selectedWord) {
        await submitResult({
          participantId: session.participantId,
          word: selectedWord.id,
          correct: won,
          timeTakenSeconds: elapsedSec,
        });
      }
    },
    [session, selectedWord]
  );

  // 5. Timer loop during drawing phase
  useEffect(() => {
    if (phase !== "drawing") return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleEndRound(false); // Time's up
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, handleEndRound]);

  // 6. Real-time AI Inference sampling loop
  useEffect(() => {
    if (phase !== "drawing" || !selectedWord) return;

    const interval = setInterval(async () => {
      if (isEvaluatingRef.current || !canvasRef.current) return;
      
      // Sample only when canvas is dirty
      if (!canvasRef.current.consumeDirty()) return;

      isEvaluatingRef.current = true;
      try {
        const snapshot = canvasRef.current.getSnapshot();
        if (snapshot) {
          const predictions = await predict(snapshot);
          if (predictions && predictions.length > 0) {
            setTopConfidence(predictions[0].confidence);
            const nextState = evaluateGuess(predictions, selectedWord, guessStateRef.current);
            guessStateRef.current = nextState;
            setGuessState(nextState);

            if (nextState.won) {
              handleEndRound(true);
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
  }, [phase, selectedWord, handleEndRound]);

  // 7. Play again -> reset to word selection
  const handlePlayAgain = () => {
    setWordChoices(pickThreeWords());
    setSelectedWord(null);
    setGuessState(INITIAL_GUESS_STATE);
    guessStateRef.current = INITIAL_GUESS_STATE;
    setPhase("word-select");
  };

  if (!session) {
    return null; // Redirecting
  }

  return (
    <ScreenShell showLogo={true}>
      <div className="flex flex-1 flex-col h-[calc(100dvh-57px)] p-4 max-w-lg mx-auto w-full">
        {/* Header Strip with player name & timer */}
        {phase === "drawing" && selectedWord && (
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-muted">Target:</span>
              <span className="text-lg font-extrabold capitalize text-ieee-blue">
                {selectedWord.id}
              </span>
            </div>

            <div
              className={`flex items-center gap-1 font-mono text-lg font-bold px-3 py-1 rounded-lg border ${
                timeLeft <= 15
                  ? "text-urgent border-urgent/30 bg-urgent/10 animate-pulse"
                  : "text-ink border-surface-muted bg-surface-muted"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{timeLeft}s</span>
            </div>
          </div>
        )}

        {/* State 1: Word Selection */}
        {phase === "word-select" && (
          <div className="flex-1 flex flex-col justify-center">
            {isModelLoading && (
              <div className="text-center py-2 text-xs font-semibold text-ieee-blue animate-pulse mb-2">
                Loading AI Recognition Model...
              </div>
            )}
            <WordSelector words={wordChoices} onSelect={handleSelectWord} />
          </div>
        )}

        {/* State 2: Countdown Overlay */}
        {phase === "countdown" && selectedWord && (
          <CountdownOverlay word={selectedWord} onComplete={handleCountdownComplete} />
        )}

        {/* State 3: Drawing Canvas & Live Guessing (Permanently mounted to preserve canvas DOM & model) */}
        <div className={`flex-1 flex-col space-y-3 min-h-0 ${phase === "drawing" ? "flex" : "hidden"}`}>
          <GuessStrip
            topGuess={guessState.topGuess}
            confidence={topConfidence}
            streak={guessState.streak}
          />
          <DrawingCanvas ref={canvasRef} />
        </div>

        {/* State 4: Results */}
        {phase === "result" && selectedWord && (
          <div className="flex-1 flex flex-col justify-center">
            <ResultScreen
              won={guessState.won}
              word={selectedWord.id}
              timeTakenSeconds={
                guessState.won && roundStartTimeRef.current
                  ? Math.max(0.5, Number(((Date.now() - roundStartTimeRef.current) / 1000).toFixed(1)))
                  : null
              }
              participantId={session.participantId}
              participantName={session.name}
              onPlayAgain={handlePlayAgain}
            />
          </div>
        )}

      </div>
    </ScreenShell>
  );
}
