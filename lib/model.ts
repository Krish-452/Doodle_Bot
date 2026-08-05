/**
 * TF.js sketch classifier, held as a module-level singleton (issue #5).
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
 *     Confirmed identical, in order, to the reference demo's own CLASSES array. This file is
 *     fetched once at load time — the output tensor's unit i means class_names[i], nothing else.
 *     An earlier version of this file mapped output indices against the word bank's labels
 *     instead of the model's own class list; that produced confident, consistently wrong
 *     labels because the two orderings have nothing to do with each other. Do not reintroduce
 *     that shortcut — always resolve labels through the fetched class list.
 *   - Automated (non-hand-drawn) validation only got a rough signal — see issue #3's comment
 *     for the caveat and the per-category table. Re-validate with real hand-drawn strokes
 *     before trusting any specific category as reliable.
 *
 * Rules that survive whichever model is chosen (docs/02-architecture.md § 4, CLAUDE.md):
 *   - Load once, at app start. Never per round, never per component mount.
 *   - Warm with one dummy prediction immediately after load; the first real inference is
 *     otherwise visibly slow, and it would land mid-round.
 *   - Wrap every inference in tf.tidy() — a long stall session leaks GPU tensors without it.
 *   - Serve from public/model/, not a third-party URL. Flaky stall Wi-Fi is the design case.
 */
import { MODEL_INPUT_SIZE } from "./constants";

export interface Prediction {
  /** Model class label (from public/model/class_names.txt), not the display word. Map through
   *  Word.labels to score a round. */
  label: string;
  /** 0–1. */
  confidence: number;
}

export type ModelLoadState = "idle" | "loading" | "ready" | "error";

const TOP_K = 5;
const CLASS_NAMES_URL = "/model/class_names.txt";
const MODEL_URL = "/model/model.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const singleton: { model: any; tf: any; classNames: string[] | null } = {
  model: null,
  tf: null,
  classNames: null,
};

let loadState: ModelLoadState = "idle";
let loadPromise: Promise<void> | null = null;

/** Current load state, for a UI "warming up" hint on first visit. */
export function getLoadState(): ModelLoadState {
  return loadState;
}

/** True once the model is loaded, warmed, and ready to predict. */
export function isModelReady(): boolean {
  return loadState === "ready";
}

/**
 * Loads the model and its class list, then warms it with one dummy prediction. Idempotent —
 * concurrent callers (e.g. two mounts) share the same in-flight promise rather than loading
 * twice, and once ready this resolves immediately without doing any work.
 */
export function loadModel(): Promise<void> {
  if (loadState === "ready") return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadState = "loading";

  loadPromise = (async () => {
    try {
      const tf = await import("@tensorflow/tfjs");
      singleton.tf = tf;

      const [model, classNames] = await Promise.all([
        tf.loadLayersModel(MODEL_URL),
        loadClassNames(),
      ]);

      singleton.model = model;
      singleton.classNames = classNames;

      // Warm-up: one dummy prediction so the first real inference (which would otherwise land
      // mid-round) isn't the one that pays the JIT/kernel-compile cost.
      tf.tidy(() => {
        const dummy = tf.zeros([1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]);
        model.predict(dummy);
      });

      loadState = "ready";
    } catch (err) {
      loadState = "error";
      // Reset so a later retry (e.g. next round) can attempt a fresh load rather than being
      // stuck replaying this rejection forever.
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}

async function loadClassNames(): Promise<string[]> {
  const res = await fetch(CLASS_NAMES_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${CLASS_NAMES_URL}: HTTP ${res.status}`);
  }
  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Samples the drawing canvas and returns the top-K ranked predictions, highest confidence
 * first.
 *
 * Preprocessing: draw onto an offscreen MODEL_INPUT_SIZE² canvas → grayscale → invert →
 * normalise to [0,1] → tensor [1, N, N, 1]. The invert is load-bearing: this model expects
 * white ink on black, and getting the polarity backwards yields a model that runs perfectly
 * and predicts nonsense (see the module-level comment above).
 *
 * Every tensor created here is scoped inside tf.tidy() and disposed before this function
 * returns — a multi-hour stall session must not leak GPU memory.
 */
export async function predict(source: HTMLCanvasElement): Promise<Prediction[]> {
  if (!isModelReady()) {
    await loadModel();
  }

  const { model, tf, classNames } = singleton;
  if (!model || !tf || !classNames) {
    throw new Error("lib/model.ts: predict() called but the model is not ready");
  }

  const probabilities: Float32Array = tf.tidy(() => {
    const input = preprocess(source, tf);
    const output = model.predict(input);
    return output.dataSync();
  });

  const ranked: Prediction[] = Array.from(probabilities)
    .map((confidence, i) => ({ label: classNames[i] ?? `class_${i}`, confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TOP_K);

  return ranked;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function preprocess(source: HTMLCanvasElement, tf: any) {
  const offscreen = document.createElement("canvas");
  offscreen.width = MODEL_INPUT_SIZE;
  offscreen.height = MODEL_INPUT_SIZE;
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error("lib/model.ts: could not get 2d context for offscreen canvas");
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  ctx.drawImage(source, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

  const { data } = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const buf = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  for (let i = 0; i < buf.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const gray = (r + g + b) / 3;
    buf[i] = (255 - gray) / 255; // invert + normalize: ink -> ~1, background -> ~0
  }

  return tf.tensor4d(buf, [1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]);
}
