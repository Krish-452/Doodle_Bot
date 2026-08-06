/**
 * Offline before/after comparison: evaluates the currently-shipped model (public/model/) and
 * the newly-trained candidate (public/model/_candidate_tfjs/) against the same held-out Quick
 * Draw! samples, using the real @tensorflow/tfjs runtime (not a Python re-implementation).
 *
 * This is NOT the hand-drawn validation table the tracking issue requires - see
 * training/README.md. It answers a narrower, still-useful question: on data neither model was
 * trained on, does the candidate do at least as well on held-out Quick Draw! samples before
 * anyone picks up a phone? A candidate that's *worse* here isn't worth hand-drawn-testing at
 * all, so this is a cheap pre-filter, not a substitute.
 *
 * Run: node training/compare_models.mjs
 */
import * as tf from "@tensorflow/tfjs";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.join(__dirname, "..", "public", "model");
const CANDIDATE_DIR = path.join(MODEL_DIR, "_candidate_tfjs");
const DATA_DIR = path.join(__dirname, "data");

const CLASSES = [
  "house", "sun", "umbrella", "fish", "bicycle", "flower", "pizza", "envelope",
  "airplane", "crown", "lightning", "wristwatch", "spider", "sword", "camera",
  "ladder", "sailboat", "drums",
];

const SAMPLES_PER_CLASS_FOR_EVAL = 300; // small, fast, held-out slice from the tail of each file

function fileSystemIOHandler(dir) {
  return {
    load: async () => {
      const modelJSON = JSON.parse(readFileSync(path.join(dir, "model.json"), "utf-8"));
      const weightsManifest = modelJSON.weightsManifest;
      const buffers = [];
      for (const g of weightsManifest) for (const p of g.paths) buffers.push(readFileSync(path.join(dir, p)));
      const weightData = Buffer.concat(buffers);
      return {
        modelTopology: modelJSON.modelTopology,
        weightSpecs: weightsManifest.flatMap((g) => g.weights),
        weightData: weightData.buffer.slice(weightData.byteOffset, weightData.byteOffset + weightData.byteLength),
        format: modelJSON.format,
      };
    },
  };
}

// Minimal .npy reader (uint8, no fortran order) - good enough for our own download format.
function readNpy(filePath) {
  const buf = readFileSync(filePath);
  if (buf.toString("ascii", 1, 6) !== "NUMPY") throw new Error(`${filePath}: not a .npy file`);
  const majorVersion = buf[6];
  let headerLen, headerStart;
  if (majorVersion === 1) {
    headerLen = buf.readUInt16LE(8);
    headerStart = 10;
  } else {
    headerLen = buf.readUInt32LE(8);
    headerStart = 12;
  }
  const header = buf.toString("ascii", headerStart, headerStart + headerLen);
  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/);
  const shape = shapeMatch[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const dataStart = headerStart + headerLen;
  const data = buf.subarray(dataStart);
  return { shape, data };
}

async function loadEvalSet() {
  const xsAll = [];
  const ys = [];
  for (let classIdx = 0; classIdx < CLASSES.length; classIdx++) {
    const name = CLASSES[classIdx];
    const { shape, data } = readNpy(path.join(DATA_DIR, `${name}.npy`));
    const [total, rowLen] = shape;
    // Take from the END of the file - train.py shuffles with a fixed seed before splitting,
    // so this isn't guaranteed to be disjoint from its validation slice, but it IS guaranteed
    // to be data the *shipped* model (trained before this download even happened) never saw,
    // which is the comparison that matters here.
    const start = total - SAMPLES_PER_CLASS_FOR_EVAL;
    for (let i = 0; i < SAMPLES_PER_CLASS_FOR_EVAL; i++) {
      const rowStart = (start + i) * rowLen;
      const row = data.subarray(rowStart, rowStart + rowLen);
      const inverted = new Float32Array(rowLen);
      for (let j = 0; j < rowLen; j++) inverted[j] = row[j] / 255; // ink=255 -> 1.0, matches training polarity
      xsAll.push(inverted);
      ys.push(classIdx);
    }
  }
  return { xs: xsAll, ys };
}

async function evaluate(modelDir, xs, ys) {
  const model = await tf.loadLayersModel(fileSystemIOHandler(modelDir));
  const perClassCorrect = new Array(CLASSES.length).fill(0);
  const perClassTotal = new Array(CLASSES.length).fill(0);

  const batchSize = 500;
  for (let i = 0; i < xs.length; i += batchSize) {
    const batchXs = xs.slice(i, i + batchSize);
    const batchYs = ys.slice(i, i + batchSize);
    const input = tf.tensor4d(
      Float32Array.from(batchXs.flatMap((a) => Array.from(a))),
      [batchXs.length, 28, 28, 1]
    );
    const output = model.predict(input);
    const preds = await output.argMax(-1).data();
    input.dispose();
    output.dispose();
    for (let j = 0; j < batchYs.length; j++) {
      perClassTotal[batchYs[j]]++;
      if (preds[j] === batchYs[j]) perClassCorrect[batchYs[j]]++;
    }
  }

  const table = {};
  for (let c = 0; c < CLASSES.length; c++) {
    table[CLASSES[c]] = perClassCorrect[c] / perClassTotal[c];
  }
  return table;
}

async function main() {
  console.log(`Loading ${SAMPLES_PER_CLASS_FOR_EVAL} held-out samples per class...`);
  const { xs, ys } = await loadEvalSet();

  console.log("Evaluating shipped model (public/model/)...");
  const shipped = await evaluate(MODEL_DIR, xs, ys);

  let candidate = null;
  if (existsSync(path.join(CANDIDATE_DIR, "model.json"))) {
    console.log("Evaluating candidate model (public/model/_candidate_tfjs/)...");
    candidate = await evaluate(CANDIDATE_DIR, xs, ys);
  } else {
    console.log("No candidate found at public/model/_candidate_tfjs/ - run training/train.py first.");
  }

  console.log("\n=== Offline held-out comparison (NOT the hand-drawn gate) ===");
  console.log(`${"class".padEnd(12)}${"shipped".padStart(10)}${candidate ? "candidate".padStart(12) : ""}`);
  let shippedSum = 0, candidateSum = 0;
  for (const name of CLASSES) {
    const s = shipped[name];
    shippedSum += s;
    let line = `${name.padEnd(12)}${(s * 100).toFixed(1).padStart(9)}%`;
    if (candidate) {
      const c = candidate[name];
      candidateSum += c;
      line += `${(c * 100).toFixed(1).padStart(11)}%`;
    }
    console.log(line);
  }
  console.log(`${"MEAN".padEnd(12)}${((shippedSum / CLASSES.length) * 100).toFixed(1).padStart(9)}%` +
    (candidate ? `${((candidateSum / CLASSES.length) * 100).toFixed(1).padStart(11)}%` : ""));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
