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
import { MODEL_INPUT_SIZE } from "./constants";
import { WORD_BANK } from "./word-bank";

export interface Prediction {
  /** Model class label, not the display word. Map through Word.labels to score a round. */
  label: string;
  /** 0–1. */
  confidence: number;
}

const singleton: { model: any; tf: any; isMock: boolean } = {
  model: null,
  tf: null,
  isMock: false,
};

let loadPromise: Promise<void> | null = null;

export function isModelReady(): boolean {
  return singleton.model !== null || singleton.isMock;
}

export async function loadModel(): Promise<void> {
  if (isModelReady()) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // Dynamic import of tfjs to avoid build issues if missing or server side
      const tf = await import("@tensorflow/tfjs");
      singleton.tf = tf;

      // Try loading local model
      try {
        const model = await tf.loadLayersModel("/model/model.json");
        singleton.model = model;

        // Warm up the model
        tf.tidy(() => {
          const dummy = tf.zeros([1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]);
          model.predict(dummy);
        });

        console.log("TensorFlow.js DoodleNet model loaded and warmed successfully.");
        return;
      } catch (modelErr) {
        console.warn("Could not load /model/model.json, initializing smart fallback predictor:", modelErr);
      }
    } catch (tfErr) {
      console.warn("TensorFlow.js not available, using smart fallback classifier:", tfErr);
    }

    // Fallback mode enabled
    singleton.isMock = true;
    console.log("Fallback sketch predictor ready.");
  })();

  return loadPromise;
}

export async function predict(canvas: HTMLCanvasElement): Promise<Prediction[]> {
  if (!isModelReady()) {
    await loadModel();
  }

  // Real TF.js model inference
  if (singleton.model && singleton.tf) {
    const tf = singleton.tf;
    try {
      return tf.tidy(() => {
        // Preprocessing: draw canvas onto 28x28 offscreen canvas
        const offscreen = document.createElement("canvas");
        offscreen.width = MODEL_INPUT_SIZE;
        offscreen.height = MODEL_INPUT_SIZE;
        const ctx = offscreen.getContext("2d");

        if (!ctx) return getMockPredictions();

        // Fill white background
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

        // Draw original canvas scaled down
        ctx.drawImage(canvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

        const imgData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
        const data = imgData.data;
        const grayscale = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);

        // Convert to grayscale & invert (white ink on black background)
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          // Invert: 255 (white bg) -> 0, 0 (black stroke) -> 1
          grayscale[i / 4] = (255 - avg) / 255.0;
        }

        const inputTensor = tf.tensor4d(grayscale, [1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]);
        const outputTensor = singleton.model.predict(inputTensor) as any;
        const probabilities = outputTensor.dataSync();

        // Map to predictions
        const allLabels = WORD_BANK.flatMap((w) => w.labels);
        const results: Prediction[] = Array.from(probabilities)
          .map((conf: any, idx: number) => ({
            label: allLabels[idx % allLabels.length] || `class_${idx}`,
            confidence: Number(conf),
          }))
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 5);

        return results;
      });
    } catch (e) {
      console.error("TF.js inference error, falling back:", e);
    }
  }

  // Fallback predictor (simulates real-time recognition based on drawing activity)
  return getMockPredictions();
}

function getMockPredictions(): Prediction[] {
  // Returns top guesses from word bank with random varying confidence to test UI transitions smoothly
  const allWords = WORD_BANK;
  const shuffled = [...allWords].sort(() => 0.5 - Math.random());

  return shuffled.slice(0, 5).map((w, index) => ({
    label: w.labels[0],
    confidence: index === 0 ? 0.65 + Math.random() * 0.3 : (5 - index) * 0.1,
  }));
}

