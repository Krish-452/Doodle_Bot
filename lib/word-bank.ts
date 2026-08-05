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
export const WORD_BANK: Word[] = [];
