/**
 * Every tunable game constant, in one module. All of these are expected to change during
 * playtesting — that is the whole point of keeping them together. Do not scatter copies into
 * components or SQL.
 */

/** Round length. Open question: 90s or 120s — decide after playtesting. */
export const ROUND_SECONDS = 90;

/** Full-screen 3-2-1 before the canvas activates. */
export const COUNTDOWN_SECONDS = 3;

/** Words offered per round. */
export const WORDS_PER_ROUND = 3;

/** Canvas sampling cadence. Only sample when strokes changed since the last sample — an idle
 *  canvas costs nothing. */
export const SAMPLE_INTERVAL_MS = 400;

/** Win condition, part one: the target's label is top-1 at or above this confidence. */
export const CONFIDENCE_THRESHOLD = 0.25;

/**
 * Win condition, part two: sustained across this many consecutive samples. Single-frame
 * confidence spikes mid-stroke are common and produce wins that feel unearned and random.
 */
export const REQUIRED_CONSECUTIVE_SAMPLES = 2;

/** Model input is a square grayscale bitmap: [1, N, N, 1]. Confirmed against the vendored
 *  model (public/model/, see issue #3) — 28 is correct for this model, not a guess. */
export const MODEL_INPUT_SIZE = 28;

/**
 * Ranking: score = (successful_guesses × W_A) + (speed_bonus × W_B),
 * where speed_bonus sums max(0, ROUND_SECONDS − time_taken_seconds) over correct rounds.
 *
 * Starting values, not final. The leaderboard view computes the same formula in SQL — change
 * both together, or the board and the client disagree.
 */
export const RANKING_WEIGHT_GUESSES = 100; // W_A
export const RANKING_WEIGHT_SPEED = 1; // W_B

/** Matches the participants.name CHECK constraint (1–24 chars, trimmed). */
export const MAX_NAME_LENGTH = 24;

/** sessionStorage: { participantId, name }. Deliberately does not survive a tab close —
 *  there are no accounts. */
export const SESSION_STORAGE_KEY = "doodlebot.session";

/** localStorage: results that failed to submit. Retried on the next submit and on
 *  window.online, so a volunteer never has to say a game didn't count. */
export const RESULT_QUEUE_STORAGE_KEY = "doodlebot.result-queue";
