"use client";

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from "react";
import type { CanvasHandle } from "../lib/types";

interface DrawingCanvasProps {
  disabled?: boolean;
  /** Called after the player clears the canvas via the "Clear Canvas" button, so the parent
   *  can reset any guess state tied to the now-erased strokes (e.g. the "AI thinks" strip). */
  onClear?: () => void;
}

// The model was trained on monochrome Quick, Draw! bitmaps. The preprocessing pipeline
// (grayscale → invert → gamma boost in lib/model.ts) likely handles most colours fine, but
// very light colours (e.g. near-white custom picks) could produce low ink-density inputs the
// model has never seen. Worth testing a few non-black colours during #34's validation pass.
// (issue #42)
const PRESET_COLORS = [
  "#0A0A0A", // Black
  "#00629B", // IEEE Blue
  "#E74C3C", // Red
  "#E67E22", // Orange
  "#F1C40F", // Yellow
  "#2ECC71", // Green
  "#9B59B6", // Purple
  "#E84393", // Pink
];

const BRUSH_SIZES = [
  { label: "S", value: 4, iconSize: "w-2 h-2" },
  { label: "M", value: 8, iconSize: "w-3.5 h-3.5" },
  { label: "L", value: 16, iconSize: "w-5 h-5" },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c.split("").map((x) => x + x).join("");
  }
  const num = parseInt(c, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function runFloodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColorHex: string,
  width: number,
  height: number
): boolean {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const fillRgb = hexToRgb(fillColorHex);
  const fillR = fillRgb.r;
  const fillG = fillRgb.g;
  const fillB = fillRgb.b;
  const fillA = 255;

  const startIdx = (startY * width + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  const startDiff =
    Math.abs(targetR - fillR) +
    Math.abs(targetG - fillG) +
    Math.abs(targetB - fillB) +
    Math.abs(targetA - fillA);
  if (startDiff < 20) {
    return false;
  }

  const queue = new Int32Array(width * height * 2);
  let qHead = 0;
  let qTail = 0;

  queue[qTail++] = startX;
  queue[qTail++] = startY;

  const visited = new Uint8Array(width * height);
  visited[startY * width + startX] = 1;

  const isMatch = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    const diff =
      Math.abs(r - targetR) +
      Math.abs(g - targetG) +
      Math.abs(b - targetB) +
      Math.abs(a - targetA);

    return diff <= 70;
  };

  while (qHead < qTail) {
    const x = queue[qHead++];
    const y = queue[qHead++];
    const idx = (y * width + x) * 4;

    data[idx] = fillR;
    data[idx + 1] = fillG;
    data[idx + 2] = fillB;
    data[idx + 3] = fillA;

    if (x + 1 < width) {
      const nIdx = y * width + (x + 1);
      if (!visited[nIdx]) {
        visited[nIdx] = 1;
        if (isMatch(nIdx * 4)) {
          queue[qTail++] = x + 1;
          queue[qTail++] = y;
        }
      }
    }
    if (x - 1 >= 0) {
      const nIdx = y * width + (x - 1);
      if (!visited[nIdx]) {
        visited[nIdx] = 1;
        if (isMatch(nIdx * 4)) {
          queue[qTail++] = x - 1;
          queue[qTail++] = y;
        }
      }
    }
    if (y + 1 < height) {
      const nIdx = (y + 1) * width + x;
      if (!visited[nIdx]) {
        visited[nIdx] = 1;
        if (isMatch(nIdx * 4)) {
          queue[qTail++] = x;
          queue[qTail++] = y + 1;
        }
      }
    }
    if (y - 1 >= 0) {
      const nIdx = (y - 1) * width + x;
      if (!visited[nIdx]) {
        visited[nIdx] = 1;
        if (isMatch(nIdx * 4)) {
          queue[qTail++] = x;
          queue[qTail++] = y - 1;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return true;
}

export const DrawingCanvas = forwardRef<CanvasHandle, DrawingCanvasProps>(
  ({ disabled = false, onClear }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawingRef = useRef<boolean>(false);
    const isDirtyRef = useRef<boolean>(false);
    const strokeHistoryRef = useRef<ImageData[]>([]);
    const [canUndo, setCanUndo] = useState(false);

    // Tools & Colors state
    const [activeTool, setActiveTool] = useState<"brush" | "bucket">("brush");
    const [activeColor, setActiveColor] = useState<string>("#0A0A0A");
    const [brushSize, setBrushSize] = useState<number>(8);

    // Context setup helper
    const initContext = useCallback(
      (ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = brushSize;
      },
      [activeColor, brushSize]
    );

    // Canvas Sizing and Snapshot Persistence across Resizes
    const updateCanvasSize = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.round(rect.width * dpr);
      const targetHeight = Math.round(rect.height * dpr);

      if (canvas.width === targetWidth && canvas.height === targetHeight) return;

      let tempCanvas: HTMLCanvasElement | null = null;
      if (canvas.width > 0 && canvas.height > 0) {
        tempCanvas = document.createElement("canvas");
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.drawImage(canvas, 0, 0);
        }
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      initContext(ctx, rect.width, rect.height, dpr);

      if (tempCanvas && tempCanvas.width > 0 && tempCanvas.height > 0) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(
          tempCanvas,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height,
          0,
          0,
          targetWidth,
          targetHeight
        );
        ctx.restore();
        initContext(ctx, rect.width, rect.height, dpr);
      }
    }, [initContext]);

    useEffect(() => {
      updateCanvasSize();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });

      if (canvas.parentElement) {
        resizeObserver.observe(canvas.parentElement);
      }

      return () => {
        resizeObserver.disconnect();
      };
    }, [updateCanvasSize]);

    // Save snapshot state for undo
    const saveState = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      strokeHistoryRef.current.push(imgData);
      if (strokeHistoryRef.current.length > 20) {
        strokeHistoryRef.current.shift();
      }
      setCanUndo(strokeHistoryRef.current.length > 1);
    }, []);

    // Flood fill action
    const doFloodFill = useCallback(
      (clickX: number, clickY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const startX = Math.floor(clickX * scaleX);
        const startY = Math.floor(clickY * scaleY);

        if (startX < 0 || startX >= canvas.width || startY < 0 || startY >= canvas.height)
          return;

        saveState();

        const success = runFloodFill(
          ctx,
          startX,
          startY,
          activeColor,
          canvas.width,
          canvas.height
        );
        if (success) {
          isDirtyRef.current = true;
        }
      },
      [activeColor, saveState]
    );

    // Pointer event handlers
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (activeTool === "bucket") {
        doFloodFill(x, y);
        return;
      }

      isDrawingRef.current = true;
      isDirtyRef.current = true;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      saveState();

      ctx.strokeStyle = activeColor;
      ctx.lineWidth = brushSize;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || disabled || activeTool === "bucket") return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      ctx.strokeStyle = activeColor;
      ctx.lineWidth = brushSize;
      ctx.lineTo(x, y);
      ctx.stroke();
      isDirtyRef.current = true;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }
      isDrawingRef.current = false;
    };

    const clearCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (rect.width === 0 || rect.height === 0) return;

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      initContext(ctx, rect.width, rect.height, dpr);

      isDirtyRef.current = false;
      strokeHistoryRef.current = [];
      setCanUndo(false);
      saveState();
    }, [initContext, saveState]);

    const handleUndo = () => {
      const canvas = canvasRef.current;
      if (!canvas || strokeHistoryRef.current.length <= 1) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      strokeHistoryRef.current.pop();
      const prevState = strokeHistoryRef.current[strokeHistoryRef.current.length - 1];
      if (prevState) {
        ctx.putImageData(prevState, 0, 0);
        isDirtyRef.current = true;
      }
      setCanUndo(strokeHistoryRef.current.length > 1);
    };

    // CanvasHandle Ref API
    useImperativeHandle(ref, () => ({
      getSnapshot: () => {
        return canvasRef.current!;
      },
      consumeDirty: () => {
        const dirty = isDirtyRef.current;
        isDirtyRef.current = false;
        return dirty;
      },
      clear: clearCanvas,
    }));

    return (
      <div className="relative flex flex-1 flex-col w-full h-full">
        {/* Canvas Frame — Clean white drawing surface */}
        <div className="relative flex-1 w-full rounded-3xl overflow-hidden border-4 border-ieee-blue/30 bg-white shadow-xl">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full canvas-surface cursor-crosshair touch-none select-none z-10"
            style={{
              touchAction: "none",
              WebkitTouchCallout: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {disabled && (
            <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center z-20">
              <span className="font-bold text-ink-muted text-lg bg-white/90 px-4 py-2 rounded-2xl shadow-md">
                Canvas locked 🔒
              </span>
            </div>
          )}
        </div>

        {/* Toolbar & Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-3 px-1">
          {/* Tool, Size, and Color Selector */}
          <div className="flex items-center flex-wrap gap-2.5 bg-white p-2 rounded-2xl border-2 border-fun-yellow/40 shadow-sm w-full sm:w-auto justify-center sm:justify-start">

            {/* Tool Switcher: Brush vs Bucket */}
            <div className="flex items-center bg-surface-muted p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTool("brush")}
                disabled={disabled}
                title="Brush Tool"
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                  activeTool === "brush"
                    ? "bg-white text-ink shadow-sm scale-105"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                <span>Brush</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTool("bucket")}
                disabled={disabled}
                title="Fill Bucket Tool"
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                  activeTool === "bucket"
                    ? "bg-white text-ink shadow-sm scale-105"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                <span>Fill</span>
              </button>
            </div>

            <div className="h-6 w-px bg-surface-muted mx-0.5" />

            {/* Brush Size (only for brush tool) */}
            {activeTool === "brush" && (
              <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-xl">
                {BRUSH_SIZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setBrushSize(s.value)}
                    disabled={disabled}
                    title={`Size ${s.label}`}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg font-bold text-xs transition-all ${
                      brushSize === s.value
                        ? "bg-white text-ink shadow-sm scale-105"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    <span
                      className={`rounded-full ${s.iconSize}`}
                      style={{ backgroundColor: activeColor }}
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="h-6 w-px bg-surface-muted mx-0.5" />

            {/* Color Swatches */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setActiveColor(c)}
                  disabled={disabled}
                  style={{ backgroundColor: c }}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-115 active:scale-95 border-2 ${
                    activeColor.toLowerCase() === c.toLowerCase()
                      ? "border-ink scale-110 shadow-sm ring-2 ring-fun-yellow"
                      : "border-transparent"
                  }`}
                />
              ))}

              {/* Custom Color Picker */}
              <label
                title="Custom Color"
                className="relative w-6 h-6 rounded-full border-2 border-dashed border-ink-muted cursor-pointer flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
                style={{
                  backgroundColor: PRESET_COLORS.includes(activeColor)
                    ? "transparent"
                    : activeColor,
                }}
              >
                <input
                  type="color"
                  value={activeColor}
                  onChange={(e) => setActiveColor(e.target.value)}
                  disabled={disabled}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Undo & Clear Buttons */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo || disabled}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-ink bg-white hover:bg-surface-muted border-2 border-surface-muted rounded-xl disabled:opacity-40 transition-all active:scale-95 shadow-xs"
            >
              <span>Undo</span>
            </button>

            <button
              type="button"
              onClick={() => {
                clearCanvas();
                onClear?.();
              }}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-urgent bg-urgent/10 hover:bg-urgent/20 border-2 border-urgent/20 rounded-xl disabled:opacity-40 transition-all active:scale-95 shadow-xs"
            >
              <span>Clear</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
);

DrawingCanvas.displayName = "DrawingCanvas";
