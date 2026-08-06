/**
 * TF.js sketch classifier, held as a module-level singleton (issue #5).
 *
 * Model swapped for issue #19 (FALLBACK — custom-trained small CNN, 18 classes) after
 * doodleNet (issue #3) couldn't reach acceptable real-drawing accuracy. Trained in Python
 * (tf_keras) on pre-rendered Quick, Draw! numpy_bitmap samples (12k/class), 94.5% validation
 * accuracy, exported with the tensorflowjs Python package. See scratchpad/train_py/ for the
 * training pipeline and training_report.txt for the run's numbers.
 *   - Input tensor: [1, 28, 28, 1], single grayscale channel.
 *   - Canvas is drawn black ink on white background (this project's convention).
 *   - Combined invert + normalize in one step: value = (255 - grayscale) / 255.
 *     Ink pixels -> ~1.0, background -> ~0.0. Do NOT normalize to [0,1] first and invert
 *     separately with a different formula — this exact formula is what the model saw in training.
 *     Confirmed empirically on the raw Quick, Draw! .npy source: background pixels are 0,
 *     ink pixels are positive (white-ink-on-black) — same polarity doodleNet used, so this
 *     formula carried over unchanged from the #3/#5 model swap.
 *   - Class list + order: public/model/class_names.txt (18 labels, index i = output unit i,
 *     same order as training). This file is fetched once at load time — the output tensor's
 *     unit i means class_names[i], nothing else. An earlier version of this file mapped output
 *     indices against the word bank's labels instead of the model's own class list; that
 *     produced confident, consistently wrong labels because the two orderings have nothing to
 *     do with each other. Do not reintroduce that shortcut — always resolve labels through the
 *     fetched class list.
 *   - Re-validate with real hand-drawn strokes before trusting any specific category as
 *     reliable — see issue #19's step 4 and lib/word-bank.ts for the current results.
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
    const output = (model as any).predict(input);
    return output.dataSync();
  });

  const ranked: Prediction[] = Array.from(probabilities)
    .map((confidence, i) => ({ label: classNames[i] ?? `class_${i}`, confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TOP_K);

  return ranked;
}

// Ink counts as any pixel visibly darker than the white background; this only needs to
// separate "background" from "something was drawn here", not detect fine strokes.
const INK_GRAY_THRESHOLD = 250;
// The Quick, Draw! bitmap renderer normalizes each sample to its own ink bounding box before
// rasterizing to 28x28, so drawings fill most of the frame. This project's canvas is much
// larger than 28x28 and users draw at arbitrary size/position within it — a naive full-canvas
// downscale (the previous approach) shrinks a small or off-center doodle to a tiny blob with
// nothing like the training data's fill ratio, and accuracy on real freehand drawings suffers
// badly as a result. Cropping to the ink's bounding box (plus padding) before downscaling
// matches what the model actually saw in training.
const BBOX_PADDING_FACTOR = 1.25;

/** Finds the pixel bounding box of everything drawn on `source`, or null if it's blank. */
function findInkBoundingBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (gray < INK_GRAY_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return maxX >= minX ? { minX, minY, maxX, maxY } : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function preprocess(source: HTMLCanvasElement, tf: any) {
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) {
    throw new Error("lib/model.ts: could not get 2d context for source canvas");
  }
  const sourceImage = sourceCtx.getImageData(0, 0, source.width, source.height);
  const bbox = findInkBoundingBox(sourceImage.data, source.width, source.height);

  // Square crop region in source-canvas coordinates: centered on the ink bbox, padded, and
  // falling back to the whole canvas when nothing has been drawn yet (matches prior behavior).
  let cropX: number, cropY: number, cropSize: number;
  if (bbox) {
    const bboxW = bbox.maxX - bbox.minX;
    const bboxH = bbox.maxY - bbox.minY;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    cropSize = Math.max(bboxW, bboxH, 1) * BBOX_PADDING_FACTOR;
    cropX = cx - cropSize / 2;
    cropY = cy - cropSize / 2;
  } else {
    cropSize = Math.max(source.width, source.height);
    cropX = 0;
    cropY = 0;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = MODEL_INPUT_SIZE;
  offscreen.height = MODEL_INPUT_SIZE;
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error("lib/model.ts: could not get 2d context for offscreen canvas");
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  ctx.drawImage(source, cropX, cropY, cropSize, cropSize, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

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
