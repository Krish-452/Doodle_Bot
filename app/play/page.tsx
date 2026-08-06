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
import { loadModel, isModelReady } from "../../lib/model";
import { INITIAL_GUESS_STATE } from "../../lib/guess";
import { submitResult } from "../../lib/data";
import type { CanvasHandle, GuessState, Word } from "../../lib/types";
import { ROUND_SECONDS, SESSION_STORAGE_KEY } from "../../lib/constants";
import { useRoundTimer } from "../../hooks/useRoundTimer";
import { useSampleLoop } from "../../hooks/useSampleLoop";

type RoundPhase = "word-select" | "countdown" | "drawing" | "result";

export default function PlayPage() {
  const router = useRouter();

  // Session state
  const [session, setSession] = useState<{ participantId: string; name: string } | null>(null);

  // State Machine
  const [phase, setPhase] = useState<RoundPhase>("word-select");
  const [wordChoices, setWordChoices] = useState<Word[]>([]);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);

  // Game state
  const [guessState, setGuessState] = useState<GuessState>(INITIAL_GUESS_STATE);
  const [topConfidence, setTopConfidence] = useState<number | undefined>(undefined);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(true);

  // Refs
  const canvasRef = useRef<CanvasHandle | null>(null);
  const roundStartTimeRef = useRef<number | null>(null);
  const guessStateRef = useRef<GuessState>(INITIAL_GUESS_STATE);

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
      if (parsed.participantId && parsed.name) {
        setSession(parsed);
      } else {
        router.replace("/");
      }
    } catch {
      router.replace("/");
    }

    // Load word choices
    setWordChoices(pickThreeWords());

    // Preload model once
    loadModel()
      .catch((err) => {
        console.error("Model failed to load:", err);
      })
      .finally(() => {
        setIsModelLoading(false);
      });
  }, [router]);

  // 2. Select Word action -> Go to countdown (gated on model ready)
  const handleSelectWord = (word: Word) => {
    if (isModelLoading || !isModelReady()) return;
    setSelectedWord(word);
    setPhase("countdown");
  };

  const [finalTimeSeconds, setFinalTimeSeconds] = useState<number | null>(null);

  // 3. End round helper
  const handleEndRound = useCallback(
    async (won: boolean) => {
      setPhase("result");

      const elapsedMs = roundStartTimeRef.current
        ? Date.now() - roundStartTimeRef.current
        : 0;
      const elapsedSec = won ? Math.max(0.5, Number((elapsedMs / 1000).toFixed(1))) : null;
      setFinalTimeSeconds(elapsedSec);

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

  // 4. Timer Logic
  const handleTimerExpire = useCallback(() => {
    handleEndRound(false);
  }, [handleEndRound]);

  const timeLeft = useRoundTimer(phase === "drawing", ROUND_SECONDS, handleTimerExpire);

  // 5. Sampling Loop Logic
  const handleGuessUpdate = useCallback((nextState: GuessState, confidence?: number) => {
    guessStateRef.current = nextState;
    setGuessState(nextState);
    setTopConfidence(confidence);
  }, []);

  const handleWin = useCallback(() => {
    handleEndRound(true);
  }, [handleEndRound]);

  // Erasing the canvas erases the evidence behind the current guess too - the "AI thinks"
  // strip and streak must not linger on strokes that no longer exist.
  const handleCanvasClear = useCallback(() => {
    setGuessState(INITIAL_GUESS_STATE);
    guessStateRef.current = INITIAL_GUESS_STATE;
    setTopConfidence(undefined);
  }, []);

  useSampleLoop({
    isActive: phase === "drawing",
    canvasRef,
    selectedWord,
    guessStateRef,
    onGuessUpdate: handleGuessUpdate,
    onWin: handleWin,
  });

  // 6. Countdown completed -> Start drawing phase
  const handleCountdownComplete = () => {
    setPhase("drawing");
    setGuessState(INITIAL_GUESS_STATE);
    guessStateRef.current = INITIAL_GUESS_STATE;
    setTopConfidence(undefined);
    roundStartTimeRef.current = Date.now();

    requestAnimationFrame(() => {
      canvasRef.current?.clear();
    });
  };

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
      <div className="flex flex-1 flex-col h-[calc(100dvh-57px)] p-4 max-w-lg lg:max-w-6xl mx-auto w-full">
        {/* Header Strip with target word & timer (Mobile portrait only) */}
        {phase === "drawing" && selectedWord && (
          <div className="flex lg:hidden items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-muted">Target:</span>
              <span className="text-lg font-extrabold capitalize text-ieee-blue">
                {selectedWord.id}
              </span>
            </div>

            <div
              className={`flex items-center gap-1 font-mono text-lg font-bold px-3 py-1 rounded-lg border ${
                timeLeft <= 5
                  ? "text-urgent border-urgent/30 bg-urgent/10"
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
          <div className="flex-1 flex flex-col justify-center max-w-md lg:max-w-xl mx-auto w-full">
            {isModelLoading && (
              <div className="text-center py-2 text-xs font-semibold text-ieee-blue animate-pulse mb-2">
                Loading AI Recognition Model...
              </div>
            )}
            <WordSelector
              words={wordChoices}
              onSelect={handleSelectWord}
              disabled={isModelLoading || !isModelReady()}
            />
          </div>
        )}

        {/* State 2: Countdown Overlay */}
        {phase === "countdown" && selectedWord && (
          <CountdownOverlay word={selectedWord} onComplete={handleCountdownComplete} />
        )}

        {/* State 3: Drawing Canvas & Live Guessing */}
        {/* Responsive Grid: Below lg: single column stacked. lg: 2-column layout (Canvas Left, Controls Right) */}
        <div className={`flex-1 flex-col lg:flex-row lg:grid lg:grid-cols-12 lg:gap-8 min-h-0 ${phase === "drawing" ? "flex lg:grid" : "hidden"}`}>

          {/* Left Column (Desktop): Canvas Area (Col 1-7 or 1-8) */}
          <div className="flex-1 flex flex-col min-h-0 lg:col-span-9 xl:col-span-10 h-full">
            <DrawingCanvas ref={canvasRef} onClear={handleCanvasClear} />
          </div>

          {/* Right Rail (Desktop): Word Prompt, Timer, Live Guess Strip (Col 8-12 or 9-12) */}
          <div className="lg:col-span-3 xl:col-span-2 flex flex-col justify-between space-y-4 pt-3 lg:pt-0 bg-white/80 backdrop-blur-sm rounded-2xl border border-ieee-blue/20 shadow-lg">
            {/* Desktop Target & Timer Panel */}
            <div className="hidden lg:flex flex-col space-y-3 bg-white p-5 rounded-2xl border border-ieee-blue/20 shadow-xs">
              <div className="flex items-center justify-between border-b border-surface-muted pb-3">
                <span className="text-xs font-bold text-ink-muted uppercase tracking-wider">Your Target</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-ieee-blue/10 text-ieee-blue border border-ieee-blue/20 uppercase">
                  {selectedWord?.difficulty}
                </span>
              </div>
              <div className="text-center py-1">
                <span className="text-3xl font-black capitalize text-ieee-blue tracking-tight">
                  {selectedWord?.id}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-surface-muted">
                <span className="text-xs font-semibold text-ink-muted">Time Remaining</span>
                <div
                  className={`flex items-center gap-1.5 font-mono text-xl font-black px-3 py-1 rounded-lg border ${
                    timeLeft <= 5
                      ? "text-urgent border-urgent/30 bg-urgent/10"
                      : "text-ink border-surface-muted bg-surface-muted"
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            </div>

            {/* Live Guess Strip */}
            <div className="w-full">
              <GuessStrip
                topGuess={guessState.topGuess}
                confidence={topConfidence}
                streak={guessState.streak}
              />
            </div>

            {/* Desktop Brand / Volunteer note */}
            <div className="hidden lg:block bg-ieee-blue/5 border border-ieee-blue/15 rounded-2xl p-4 text-xs text-ink-muted space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-ieee-blue">
                <span>IEEE DoodleBot AI Engine</span>
                <span className="text-ieee-cyan">•</span>
                <span className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-ieee-blue/20">Live</span>
              </div>
              <p>
                Our real-time neural network crops your drawing area to a square tensor and evaluates top match probabilities continuously.
              </p>
            </div>
          </div>
        </div>

        {/* State 4: Results */}
        {phase === "result" && selectedWord && (
          <div className="flex-1 flex flex-col justify-center max-w-md lg:max-w-xl mx-auto w-full">
            <ResultScreen
              won={guessState.won}
              word={selectedWord.id}
              timeTakenSeconds={finalTimeSeconds}
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
