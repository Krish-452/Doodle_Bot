/**
 * Offline diagnostic: replicates lib/model.ts's exact preprocessing pipeline (bbox crop,
 * downscale to 28x28, invert+normalize) and runs it through the real vendored model, using
 * synthetic "freehand" strokes (curved, drawn at natural size/position) instead of a browser.
 *
 * Not part of the app - a one-off tool to inspect why real-drawing accuracy might be weak.
 * Run: node scripts/diagnose-model.mjs
 */
import { createCanvas } from "canvas";
import * as tf from "@tensorflow/tfjs";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = process.env.MODEL_DIR
  ? path.resolve(process.env.MODEL_DIR)
  : path.join(__dirname, "..", "public", "model");
// class_names.txt lives only in public/model/ - Phase 1 candidates keep the same 18 classes in
// the same order (Phase 2, if it happens, is the one that touches this file), so a candidate
// dir without its own copy still resolves correctly against the shipped one.
const CLASS_NAMES_DIR = path.join(__dirname, "..", "public", "model");
const MODEL_INPUT_SIZE = 28;
const INK_GRAY_THRESHOLD = 250;
const BBOX_PADDING_FACTOR = 1.25;

// ---------------------------------------------------------------------------
// Synthetic "freehand" drawing generators - curved, natural-sized, roughly centered,
// with jitter to simulate a real hand/finger stroke (not perfectly smooth or geometric).
// ---------------------------------------------------------------------------

function jitter(v, amount) {
  return v + (Math.random() - 0.5) * amount;
}

function strokePath(ctx, points, lineWidth) {
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
}

function circlePoints(cx, cy, r, segments = 48, jitterAmt = 3) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push([jitter(cx + Math.cos(angle) * r, jitterAmt), jitter(cy + Math.sin(angle) * r, jitterAmt)]);
  }
  return pts;
}

function drawSun(ctx, canvasSize) {
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const r = canvasSize * 0.22;
  const lw = canvasSize * 0.018; // proportional stroke width, like a real finger/pen stroke
  strokePath(ctx, circlePoints(cx, cy, r, 48, canvasSize * 0.01), lw);
  // rays
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * (r * 1.15);
    const y1 = cy + Math.sin(angle) * (r * 1.15);
    const x2 = cx + Math.cos(angle) * (r * 1.7);
    const y2 = cy + Math.sin(angle) * (r * 1.7);
    strokePath(ctx, [[jitter(x1, 3), jitter(y1, 3)], [jitter(x2, 3), jitter(y2, 3)]], lw);
  }
}

function drawHouse(ctx, canvasSize) {
  const lw = canvasSize * 0.018;
  const left = canvasSize * 0.25, right = canvasSize * 0.75;
  const top = canvasSize * 0.45, bottom = canvasSize * 0.8, roofTip = canvasSize * 0.2;
  // walls
  strokePath(ctx, [[left, top], [left, bottom], [right, bottom], [right, top]], lw);
  // roof
  strokePath(ctx, [[left - 10, top + 5], [canvasSize / 2, roofTip], [right + 10, top + 5]], lw);
  // door
  strokePath(ctx, [[canvasSize * 0.45, bottom], [canvasSize * 0.45, canvasSize * 0.6], [canvasSize * 0.55, canvasSize * 0.6], [canvasSize * 0.55, bottom]], lw);
}

function drawUmbrella(ctx, canvasSize) {
  const lw = canvasSize * 0.018;
  const cx = canvasSize / 2;
  const cy = canvasSize * 0.4;
  const r = canvasSize * 0.25;
  // canopy arc
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const angle = Math.PI + (i / 24) * Math.PI;
    pts.push([jitter(cx + Math.cos(angle) * r, 3), jitter(cy + Math.sin(angle) * r, 3)]);
  }
  strokePath(ctx, pts, lw);
  // handle
  strokePath(ctx, [[cx, cy], [cx, cy + canvasSize * 0.4], [cx - canvasSize * 0.06, cy + canvasSize * 0.45]], lw);
}

const GENERATORS = { sun: drawSun, house: drawHouse, umbrella: drawUmbrella };

// ---------------------------------------------------------------------------
// Exact port of lib/model.ts preprocess() + findInkBoundingBox()
// ---------------------------------------------------------------------------

function findInkBoundingBox(data, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
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

function preprocess(sourceCanvas) {
  const sourceCtx = sourceCanvas.getContext("2d");
  const sourceImage = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bbox = findInkBoundingBox(sourceImage.data, sourceCanvas.width, sourceCanvas.height);

  let cropX, cropY, cropSize;
  if (bbox) {
    const bboxW = bbox.maxX - bbox.minX;
    const bboxH = bbox.maxY - bbox.minY;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    cropSize = Math.max(bboxW, bboxH, 1) * BBOX_PADDING_FACTOR;
    cropX = cx - cropSize / 2;
    cropY = cy - cropSize / 2;
  } else {
    cropSize = Math.max(sourceCanvas.width, sourceCanvas.height);
    cropX = 0;
    cropY = 0;
  }

  const offscreen = createCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const ctx = offscreen.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  ctx.drawImage(sourceCanvas, cropX, cropY, cropSize, cropSize, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

  const { data } = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  let buf = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  for (let i = 0; i < buf.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const gray = (r + g + b) / 3;
    buf[i] = (255 - gray) / 255;
  }

  if (process.env.FIX) {
    buf = dilate(buf, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    if (process.env.FIX === "2") buf = dilate(buf, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    // Boost partial-coverage (anti-aliased) ink toward full intensity instead of leaving it faint.
    for (let i = 0; i < buf.length; i++) {
      buf[i] = Math.min(1, Math.pow(buf[i], 0.6) * 1.15);
    }
  }

  return { tensor: tf.tensor4d(buf, [1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]), buf, cropSize };
}

// 3x3 max-filter dilation: grows ink outward by ~1px so thin/broken downscaled strokes become
// solid, matching the ink density real Quick,Draw! bitmaps have at 28x28.
function dilate(buf, w, h) {
  const out = new Float32Array(buf.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            max = Math.max(max, buf[ny * w + nx]);
          }
        }
      }
      out[y * w + x] = max;
    }
  }
  return out;
}

function renderAscii(buf) {
  const chars = " .:-=+*#%@";
  let out = "";
  for (let y = 0; y < MODEL_INPUT_SIZE; y++) {
    let row = "";
    for (let x = 0; x < MODEL_INPUT_SIZE; x++) {
      const v = buf[y * MODEL_INPUT_SIZE + x];
      row += chars[Math.min(chars.length - 1, Math.floor(v * chars.length))];
    }
    out += row + "\n";
  }
  return out;
}

// Plain @tensorflow/tfjs has no filesystem IOHandler (that's tfjs-node's job, and its native
// binding doesn't have a prebuild for this Node version) - so load model.json/weights by hand.
function fileSystemIOHandler() {
  return {
    load: async () => {
      const modelJSON = JSON.parse(readFileSync(path.join(MODEL_DIR, "model.json"), "utf-8"));
      const weightsManifest = modelJSON.weightsManifest;
      const weightBuffers = [];
      for (const group of weightsManifest) {
        for (const p of group.paths) {
          weightBuffers.push(readFileSync(path.join(MODEL_DIR, p)));
        }
      }
      const weightData = Buffer.concat(weightBuffers);
      return {
        modelTopology: modelJSON.modelTopology,
        weightSpecs: weightsManifest.flatMap((g) => g.weights),
        weightData: weightData.buffer.slice(
          weightData.byteOffset,
          weightData.byteOffset + weightData.byteLength
        ),
        format: modelJSON.format,
        generatedBy: modelJSON.generatedBy,
        convertedBy: modelJSON.convertedBy,
      };
    },
  };
}

async function main() {
  const model = await tf.loadLayersModel(fileSystemIOHandler());
  const classNames = readFileSync(path.join(CLASS_NAMES_DIR, "class_names.txt"), "utf-8")
    .split("\n").map((l) => l.trim()).filter(Boolean);

  // Test at a few canvas sizes to see whether accuracy varies with how large the user's
  // physical drawing area is (phones vary a lot: ~350px wide up to ~800px tall canvases).
  const CANVAS_SIZES = [400, 800, 1400];

  for (const [word, gen] of Object.entries(GENERATORS)) {
    console.log(`\n=== ${word} ===`);
    for (const size of CANVAS_SIZES) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, size, size);
      gen(ctx, size);

      const { tensor, buf, cropSize } = preprocess(canvas);
      const output = model.predict(tensor);
      const probs = await output.data();
      tensor.dispose();
      output.dispose();

      const ranked = Array.from(probs)
        .map((p, i) => ({ label: classNames[i], p }))
        .sort((a, b) => b.p - a.p)
        .slice(0, 5);

      const inkPixelCount = buf.reduce((acc, v) => acc + (v > 0.15 ? 1 : 0), 0);
      console.log(
        `  canvas=${size}px cropSize=${cropSize.toFixed(0)}px inkPixels(28x28)=${inkPixelCount}/784 (${((inkPixelCount / 784) * 100).toFixed(1)}%)`
      );
      console.log(
        "  top5:",
        ranked.map((r) => `${r.label}=${(r.p * 100).toFixed(1)}%`).join(", ")
      );
      if (size === 800) {
        console.log(renderAscii(buf).split("\n").map((l) => "    " + l).join("\n"));
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
