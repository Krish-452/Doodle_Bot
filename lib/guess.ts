import type { GuessState, Prediction, Word } from "./types";
import { CONFIDENCE_THRESHOLD, REQUIRED_CONSECUTIVE_SAMPLES } from "./constants";

/**
 * Win detection.
 *
 * Deliberately separate from lib/model.ts and deliberately free of any TF.js import: it takes
 * predictions as plain data rather than a model, so the game stream can build and unit-test
 * against it today, before the model is chosen and before @tensorflow/tfjs is even installed.
 *
 * The rule (docs/02-architecture.md § 4): one of the target's labels is top-1 at or above
 * CONFIDENCE_THRESHOLD, sustained for REQUIRED_CONSECUTIVE_SAMPLES consecutive samples.
 *
 * The second half is load-bearing. Confidence spikes mid-stroke are common — a half-drawn cat
 * momentarily reads as a very confident something-else — and without the streak requirement
 * those produce wins that feel unearned and random to the player.
 */

export const INITIAL_GUESS_STATE: GuessState = {
  topGuess: null,
  streak: 0,
  won: false,
};

/**
 * Folds one sample's predictions into the running guess state.
 *
 * Pure: same inputs, same output, no side effects. D calls it once per sample and stores the
 * result, passing it back as `previous` on the next sample.
 *
 *   - Matches against `target.labels`, not `target.id`. Some words accept several model classes
 *     ("couch" / "sofa"), and any of them counts.
 *   - `topGuess` is the display label when the top prediction matches the target, and the raw
 *     model class otherwise — it is shown to the player as "AI thinks: ___", win or not.
 *   - `streak` resets to 0 on any sample where the target is not top-1 above threshold. The
 *     samples must be consecutive; a near-miss in between does not carry the streak.
 *   - Once `won` is true, this returns early and leaves it true — terminal state.
 */
export function evaluateGuess(
  predictions: Prediction[],
  target: Word,
  previous: GuessState,
): GuessState {
  if (previous.won) {
    return previous;
  }

  if (!predictions || predictions.length === 0) {
    return previous;
  }

  const top = predictions[0];
  const isTargetTop = target.labels.some(
    (label) => label.toLowerCase() === top.label.toLowerCase(),
  );

  const displayGuess = isTargetTop ? target.id : top.label;

  if (isTargetTop && top.confidence >= CONFIDENCE_THRESHOLD) {
    const nextStreak = previous.streak + 1;
    const isWon = nextStreak >= REQUIRED_CONSECUTIVE_SAMPLES;
    return {
      topGuess: displayGuess,
      streak: nextStreak,
      won: isWon,
    };
  }

  return {
    topGuess: displayGuess,
    streak: 0,
    won: false,
  };
}

