import { describe, expect, it } from "vitest";
import { evaluateGuess, INITIAL_GUESS_STATE } from "./guess";
import { CONFIDENCE_THRESHOLD, REQUIRED_CONSECUTIVE_SAMPLES } from "./constants";
import type { Prediction, Word } from "./types";

const couch: Word = { id: "couch", labels: ["couch", "sofa"], difficulty: "easy" };

function prediction(label: string, confidence: number): Prediction[] {
  return [{ label, confidence }];
}

describe("evaluateGuess", () => {
  it("does not win on a single qualifying sample", () => {
    const state = evaluateGuess(prediction("couch", 0.9), couch, INITIAL_GUESS_STATE);
    expect(state.won).toBe(false);
    expect(state.streak).toBe(1);
  });

  it("wins on two consecutive qualifying samples", () => {
    const first = evaluateGuess(prediction("couch", 0.9), couch, INITIAL_GUESS_STATE);
    const second = evaluateGuess(prediction("couch", 0.9), couch, first);
    expect(second.won).toBe(true);
    expect(second.streak).toBe(REQUIRED_CONSECUTIVE_SAMPLES);
  });

  it("resets the streak when a miss falls between two hits", () => {
    const first = evaluateGuess(prediction("couch", 0.9), couch, INITIAL_GUESS_STATE);
    const miss = evaluateGuess(prediction("chair", 0.9), couch, first);
    expect(miss.streak).toBe(0);

    const second = evaluateGuess(prediction("couch", 0.9), couch, miss);
    expect(second.won).toBe(false);
    expect(second.streak).toBe(1);
  });

  it("resets the streak when confidence drops below threshold", () => {
    const first = evaluateGuess(prediction("couch", 0.9), couch, INITIAL_GUESS_STATE);
    const belowThreshold = evaluateGuess(
      prediction("couch", CONFIDENCE_THRESHOLD - 0.01),
      couch,
      first,
    );
    expect(belowThreshold.streak).toBe(0);
    expect(belowThreshold.won).toBe(false);
  });

  it("counts a synonym label as a qualifying hit", () => {
    const first = evaluateGuess(prediction("sofa", 0.9), couch, INITIAL_GUESS_STATE);
    const second = evaluateGuess(prediction("sofa", 0.9), couch, first);
    expect(second.won).toBe(true);
  });

  it("stays won once won, regardless of subsequent samples", () => {
    const won: ReturnType<typeof evaluateGuess> = { topGuess: "couch", streak: 2, won: true };
    const next = evaluateGuess(prediction("dog", 0.99), couch, won);
    expect(next).toBe(won);
  });

  it("surfaces topGuess as the target's display id when matched", () => {
    const state = evaluateGuess(prediction("sofa", 0.9), couch, INITIAL_GUESS_STATE);
    expect(state.topGuess).toBe("couch");
  });

  it("surfaces topGuess as the raw model class when not a match, without affecting win state", () => {
    const state = evaluateGuess(prediction("dog", 0.99), couch, INITIAL_GUESS_STATE);
    expect(state.topGuess).toBe("dog");
    expect(state.won).toBe(false);
    expect(state.streak).toBe(0);
  });

  it("is case-insensitive when matching labels", () => {
    const state = evaluateGuess(prediction("COUCH", 0.9), couch, INITIAL_GUESS_STATE);
    expect(state.streak).toBe(1);
  });

  it("respects a confidence threshold change from constants.ts alone", () => {
    // Sanity check that the exported threshold is what gates qualification, not a hardcoded
    // literal in guess.ts — a value just above the real threshold must qualify, and a value
    // just below must not.
    const above = evaluateGuess(
      prediction("couch", CONFIDENCE_THRESHOLD + 0.001),
      couch,
      INITIAL_GUESS_STATE,
    );
    const below = evaluateGuess(
      prediction("couch", CONFIDENCE_THRESHOLD - 0.001),
      couch,
      INITIAL_GUESS_STATE,
    );
    expect(above.streak).toBe(1);
    expect(below.streak).toBe(0);
  });
});
