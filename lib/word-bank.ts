/**
 * Static typed word list — no fetch, no database round-trip. A TS module rather than JSON in
 * public/: it is type-checked at build time, tree-shaken into the bundle, and cannot 404 at
 * the stall.
 *
 * Every `labels` entry must be a real class the model emits (public/model/class_names.txt) —
 * verified by `scripts/verify-word-bank.mjs`, not eyeballed. Run it after any edit here:
 *   node scripts/verify-word-bank.mjs
 *
 * Model source (issue #19, FALLBACK): the vendored model was replaced with a custom-trained
 * 18-class CNN after doodleNet (issue #3/#6) couldn't reach acceptable real-drawing accuracy.
 * This word bank is now a 1:1 mapping over all 18 of the new model's classes — every word
 * below IS the full class list, in no particular order relative to it.
 *
 * All 18 words have been through real hand-drawn validation (issue #19 step 4, repeated
 * across multiple rounds after fixing a bounding-box-crop preprocessing bug in lib/model.ts
 * that was suppressing accuracy on natural-sized/off-center drawings): each hit target
 * confidence on freehand strokes, not just synthetic canned paths. Categories that were shakier
 * in early testing (flower, pizza, airplane, wristwatch, crown, lightning, spider, sailboat,
 * drums) turned out to fail mainly against straight-line/geometric test strokes; drawn with
 * natural curved freehand strokes — the actual shape of real participant input — they hit
 * reliably too.
 *
 * This deliberately does NOT hit the 40-60 word recommendation from issue #6 — the model
 * backing it only has 18 trained classes (issue #19's fallback CNN, not the 345-class
 * doodleNet originally targeted). Flagged per issue #19's acceptance criteria: word bank
 * shrinks to the model's real class count, team is to be told explicitly rather than this
 * being silently smaller than #6 planned for.
 */

export type Difficulty = "easy" | "medium" | "hard";

export interface Word {
  /** Display label shown to the participant. */
  id: string;
  /** Model class labels that count as a correct guess. */
  labels: string[];
  difficulty: Difficulty;
}

export const WORD_BANK: Word[] = [
  // Easy
  { id: "house", labels: ["house"], difficulty: "easy" },
  { id: "sun", labels: ["sun"], difficulty: "easy" },
  { id: "umbrella", labels: ["umbrella"], difficulty: "easy" },
  { id: "fish", labels: ["fish"], difficulty: "easy" },
  { id: "envelope", labels: ["envelope"], difficulty: "easy" },
  { id: "pizza", labels: ["pizza"], difficulty: "easy" },

  // Medium
  { id: "ladder", labels: ["ladder"], difficulty: "medium" },
  { id: "lightning", labels: ["lightning"], difficulty: "medium" },
  { id: "bicycle", labels: ["bicycle"], difficulty: "medium" },
  { id: "flower", labels: ["flower"], difficulty: "medium" },
  { id: "crown", labels: ["crown"], difficulty: "medium" },
  { id: "sailboat", labels: ["sailboat"], difficulty: "medium" },

  // Hard
  { id: "airplane", labels: ["airplane"], difficulty: "hard" },
  { id: "wristwatch", labels: ["wristwatch"], difficulty: "hard" },
  { id: "spider", labels: ["spider"], difficulty: "hard" },
  { id: "sword", labels: ["sword"], difficulty: "hard" },
  { id: "camera", labels: ["camera"], difficulty: "hard" },
  { id: "drums", labels: ["drums"], difficulty: "hard" },
];

/** Picks 3 distinct random words from the bank. */
export function pickThree(): Word[] {
  const shuffled = [...WORD_BANK].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3);
}

/** @deprecated Use {@link pickThree}. Kept as an alias so existing call sites don't break. */
export const pickThreeWords = pickThree;
