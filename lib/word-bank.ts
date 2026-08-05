/**
 * Static typed word list — no fetch, no database round-trip. A TS module rather than JSON in
 * public/: it is type-checked at build time, tree-shaken into the bundle, and cannot 404 at
 * the stall.
 */

export type Difficulty = "easy" | "medium" | "hard";

export interface Word {
  /** Display label shown to the participant. */
  id: string;
  /** Model class labels that count as a correct guess. Some words have several ("couch"/"sofa"). */
  labels: string[];
  difficulty: Difficulty;
}

/**
 * TODO: fill this in *after* the model is sourced and validated. The bank is derived from
 * whichever classes the model handles reliably — not chosen first — so it stays empty until
 * that hour-0 task is done. Target 40–60 words, balanced across difficulties, avoiding
 * obscure or mutually ambiguous categories.
 *
 *   { id: "couch", labels: ["couch", "sofa"], difficulty: "easy" },
 */
export const WORD_BANK: Word[] = [
  // Easy
  { id: "apple", labels: ["apple"], difficulty: "easy" },
  { id: "banana", labels: ["banana"], difficulty: "easy" },
  { id: "bicycle", labels: ["bicycle"], difficulty: "easy" },
  { id: "cat", labels: ["cat"], difficulty: "easy" },
  { id: "clock", labels: ["clock"], difficulty: "easy" },
  { id: "cloud", labels: ["cloud"], difficulty: "easy" },
  { id: "cup", labels: ["cup", "mug"], difficulty: "easy" },
  { id: "door", labels: ["door"], difficulty: "easy" },
  { id: "eye", labels: ["eye"], difficulty: "easy" },
  { id: "fish", labels: ["fish"], difficulty: "easy" },
  { id: "flower", labels: ["flower"], difficulty: "easy" },
  { id: "hat", labels: ["hat"], difficulty: "easy" },
  { id: "house", labels: ["house"], difficulty: "easy" },
  { id: "moon", labels: ["moon"], difficulty: "easy" },
  { id: "mountain", labels: ["mountain"], difficulty: "easy" },
  { id: "pizza", labels: ["pizza"], difficulty: "easy" },
  { id: "star", labels: ["star"], difficulty: "easy" },
  { id: "sun", labels: ["sun"], difficulty: "easy" },
  { id: "tree", labels: ["tree"], difficulty: "easy" },
  { id: "umbrella", labels: ["umbrella"], difficulty: "easy" },

  // Medium
  { id: "airplane", labels: ["airplane"], difficulty: "medium" },
  { id: "book", labels: ["book"], difficulty: "medium" },
  { id: "car", labels: ["car"], difficulty: "medium" },
  { id: "chair", labels: ["chair"], difficulty: "medium" },
  { id: "couch", labels: ["couch", "sofa"], difficulty: "medium" },
  { id: "donut", labels: ["donut"], difficulty: "medium" },
  { id: "envelope", labels: ["envelope"], difficulty: "medium" },
  { id: "glasses", labels: ["glasses", "eyeglasses"], difficulty: "medium" },
  { id: "guitar", labels: ["guitar"], difficulty: "medium" },
  { id: "ice cream", labels: ["ice cream"], difficulty: "medium" },
  { id: "key", labels: ["key"], difficulty: "medium" },
  { id: "ladder", labels: ["ladder"], difficulty: "medium" },
  { id: "light bulb", labels: ["light bulb"], difficulty: "medium" },
  { id: "lightning", labels: ["lightning"], difficulty: "medium" },
  { id: "mobile phone", labels: ["cell phone", "mobile phone"], difficulty: "medium" },
  { id: "scissors", labels: ["scissors"], difficulty: "medium" },
  { id: "t-shirt", labels: ["t-shirt", "tshirt"], difficulty: "medium" },
  { id: "table", labels: ["table"], difficulty: "medium" },
  { id: "umbrella", labels: ["umbrella"], difficulty: "medium" },
  { id: "wheel", labels: ["wheel"], difficulty: "medium" },

  // Hard
  { id: "anchor", labels: ["anchor"], difficulty: "hard" },
  { id: "bird", labels: ["bird"], difficulty: "hard" },
  { id: "bridge", labels: ["bridge"], difficulty: "hard" },
  { id: "camera", labels: ["camera"], difficulty: "hard" },
  { id: "castle", labels: ["castle"], difficulty: "hard" },
  { id: "crown", labels: ["crown"], difficulty: "hard" },
  { id: "diamond", labels: ["diamond"], difficulty: "hard" },
  { id: "drum", labels: ["drum"], difficulty: "hard" },
  { id: "finger", labels: ["finger"], difficulty: "hard" },
  { id: "lighthouse", labels: ["lighthouse"], difficulty: "hard" },
  { id: "microphone", labels: ["microphone"], difficulty: "hard" },
  { id: "sailboat", labels: ["sailboat"], difficulty: "hard" },
  { id: "spider", labels: ["spider"], difficulty: "hard" },
  { id: "sword", labels: ["sword"], difficulty: "hard" },
  { id: "wristwatch", labels: ["wristwatch"], difficulty: "hard" }
];

/** Helper to pick 3 distinct random words from the bank */
export function pickThreeWords(): Word[] {
  const shuffled = [...WORD_BANK].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3);
}

