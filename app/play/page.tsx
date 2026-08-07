"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

  // Random sized decorative background dots OUTSIDE the canvas
  const bgDots = useMemo(() => {
    const colors = [
      "#FFD93D",
      "#FF8C42",
      "#FF6B9D",
      "#6BCB77",
      "#9B59B6",
      "#4fd9ff",
      "#00629b",
      "#FF6F61",
    ];
    return Array.from({ length: 28 }).map((_, i) => ({
      id: i,
      left: `${Math.floor(Math.random() * 92) + 4}%`,
      top: `${Math.floor(Math.random() * 92) + 4}%`,
      size: `${Math.floor(Math.random() * 28) + 10}px`,
      color: colors[i % colors.length],
      opacity: (Math.random() * 0.4 + 0.25).toFixed(2),
      delay: `${(Math.random() * 3.5).toFixed(1)}s`,
    }));
  }, []);

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

  // Erasing the canvas erases the evidence behind the current guess too
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
      <div className="relative flex flex-1 flex-col h-[calc(100dvh-57px)] p-4 max-w-lg lg:max-w-6xl mx-auto w-full doodle-bg overflow-hidden">

        {/* Random sized decorative dots OUTSIDE the canvas */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          {bgDots.map((dot) => (
            <div
              key={dot.id}
              className="absolute rounded-full animate-float"
              style={{
                left: dot.left,
                top: dot.top,
                width: dot.size,
                height: dot.size,
                backgroundColor: dot.color,
                opacity: dot.opacity,
                animationDelay: dot.delay,
              }}
            />
          ))}
        </div>

        {/* Header Strip with target word & timer (Mobile portrait only) */}
        {(phase === "drawing" || phase === "result") && selectedWord && (
          <div className="relative z-10 flex lg:hidden items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎯</span>
              <span
                className="text-lg font-bold capitalize text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {selectedWord.id}
              </span>
            </div>

            <div
              className={`flex items-center gap-1.5 font-mono text-lg font-bold px-3 py-1.5 rounded-xl border-2 ${
                timeLeft <= 5
                  ? "text-fun-coral border-fun-coral/40 bg-fun-coral/10 animate-pulse"
                  : "text-ink border-fun-yellow/40 bg-fun-yellow/10"
              }`}
            >
              <span>⏱️</span>
              <span>{timeLeft}s</span>
            </div>
          </div>
        )}

        {/* State 1: Word Selection Modal */}
        {phase === "word-select" && (
          <>
            {isModelLoading && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm">
                <div className="text-center space-y-3 animate-pulse">
                  <span className="text-5xl block animate-float">🤖</span>
                  <p className="text-sm font-bold text-ieee-blue">Warming up AI brain...</p>
                </div>
              </div>
            )}
            <WordSelector
              words={wordChoices}
              onSelect={handleSelectWord}
              disabled={isModelLoading || !isModelReady()}
            />
          </>
        )}

        {/* State 2: Countdown Overlay */}
        {phase === "countdown" && selectedWord && (
          <CountdownOverlay word={selectedWord} onComplete={handleCountdownComplete} />
        )}

        {/* State 3 & 4: Drawing Canvas & Live Guessing */}
        {/* Canvas stays visible during result phase so drawing is visible behind modal */}
        <div className={`relative z-10 flex-1 flex-col lg:flex-row lg:grid lg:grid-cols-12 lg:gap-6 min-h-0 ${(phase === "drawing" || phase === "result") ? "flex lg:grid" : "hidden"}`}>

          {/* Left Column: Drawing Canvas */}
          <div className="flex-1 flex flex-col min-h-0 lg:col-span-8 h-full">
            <DrawingCanvas ref={canvasRef} disabled={phase === "result"} onClear={handleCanvasClear} />
          </div>

          {/* Right Rail: Target, Timer, Live AI Guess */}
          <div className="lg:col-span-4 flex flex-col gap-4 pt-3 lg:pt-0 overflow-hidden">
            {/* Desktop Target & Timer Panel */}
            <div className="hidden lg:flex flex-col space-y-3 p-5 rounded-2xl bg-white/90 backdrop-blur-sm border-2 border-fun-yellow/30 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink-muted flex items-center gap-1.5">
                  🎯 Draw this!
                </span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface-muted text-ink-muted border border-surface-muted uppercase">
                  {selectedWord?.difficulty}
                </span>
              </div>
              <div className="text-center py-2">
                <span
                  className="text-4xl font-bold capitalize text-ink tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {selectedWord?.id}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-surface-muted">
                <span className="text-xs font-semibold text-ink-muted">⏱️ Time left</span>
                <div
                  className={`flex items-center gap-1.5 font-mono text-2xl font-black px-4 py-1.5 rounded-xl border-2 ${
                    timeLeft <= 5
                      ? "text-fun-coral border-fun-coral/40 bg-fun-coral/10 animate-pulse"
                      : "text-ink border-fun-green/40 bg-fun-green/10"
                  }`}
                >
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

            {/* Desktop AI info banner */}
            <div className="hidden lg:flex flex-col gap-2 p-4 rounded-2xl bg-white/80 border border-fun-purple/20 text-xs text-ink-muted shadow-xs">
              <div className="flex items-center gap-1.5 font-bold text-fun-purple">
                <span>🤖 AI is watching</span>
                <span className="text-[10px] bg-fun-green/20 text-fun-green px-1.5 py-0.5 rounded-full border border-fun-green/30 font-bold">LIVE</span>
              </div>
              <p>
                The AI model is analyzing your sketch in real-time! Draw clearly to beat the clock.
              </p>
            </div>
          </div>
        </div>

        {/* State 4: Results — Modal overlay rendered ON TOP of the canvas */}
        {phase === "result" && selectedWord && (
          <ResultScreen
            won={guessState.won}
            word={selectedWord.id}
            timeTakenSeconds={finalTimeSeconds}
            participantId={session.participantId}
            participantName={session.name}
            onPlayAgain={handlePlayAgain}
          />
        )}

      </div>
    </ScreenShell>
  );
}
