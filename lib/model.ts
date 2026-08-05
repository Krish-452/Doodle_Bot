/**
 * TF.js sketch classifier, held as a module-level singleton.
 *
 * @tensorflow/tfjs is deliberately not installed yet: which model to use, and which classes it
 * handles reliably, is still open, and the word bank is derived from the answer. Add the
 * dependency in the same pass that fills these bodies in.
 *
 * Model sourced and vendored for issue #3 (doodleNet, 345-class QuickDraw CNN — see
 * https://github.com/yining1023/doodleNet). Validated preprocessing spec, confirmed against
 * the vendored model.json and the reference demo's own preprocessing code:
 *   - Input tensor: [1, 28, 28, 1], single grayscale channel.
 *   - Canvas is drawn black ink on white background (this project's convention).
 *   - Combined invert + normalize in one step: value = (255 - grayscale) / 255.
 *     Ink pixels -> ~1.0, background -> ~0.0. Do NOT normalize to [0,1] first and invert
 *     separately with a different formula — this exact formula is what the model saw in training.
 *   - Class list + order: public/model/class_names.txt (345 labels, index i = output unit i).
 *     Confirmed identical, in order, to the reference demo's own CLASSES array.
 *   - Automated (non-hand-drawn) validation only got a rough signal — see issue #3's comment
 *     for the caveat and the per-category table. Re-validate with real hand-drawn strokes
 *     before trusting any specific category as reliable.
 *
 * Rules that survive whichever model is chosen (docs/02-architecture.md § 4):
 *   - Load once, at app start. Never per round, never per component mount.
 *   - Warm with one dummy prediction on load; the first real inference is otherwise visibly slow.
 *   - Wrap every inference in tf.tidy() — a long stall session leaks GPU tensors without it.
 *   - Serve from public/model/, not a third-party URL. Flaky stall Wi-Fi is the design case.
 */

export interface Prediction {
  /** Model class label, not the display word. Map through Word.labels to score a round. */
  label: string;
  /** 0–1. */
  confidence: number;
}

/** The one loaded instance, for the lifetime of the tab. A holder rather than a bare `let` so
 *  the reference stays const while the model inside it is swapped in on load. */
const singleton: { model: unknown } = { model: null };

export function isModelReady(): boolean {
  return singleton.model !== null;
}

/**
 * Loads the model from /model/ and warms it. Idempotent — safe to call from more than one
 * mount; the second call should reuse the in-flight promise rather than load twice.
 */
export async function loadModel(): Promise<void> {
  throw new Error("lib/model.ts: loadModel() not implemented");
}

/**
 * Samples the drawing canvas and returns ranked guesses.
 *
 * Preprocessing: draw onto an offscreen MODEL_INPUT_SIZE² canvas → grayscale → invert →
 * normalise to [0,1] → tensor [1, N, N, 1]. The invert is load-bearing: Quick, Draw!–trained
 * models expect white ink on black, and getting the polarity backwards yields a model that
 * runs perfectly and predicts nonsense.
 */
export async function predict(canvas: HTMLCanvasElement): Promise<Prediction[]> {
  throw new Error(
    `lib/model.ts: predict() not implemented (canvas ${canvas.width}×${canvas.height})`,
  );
}
