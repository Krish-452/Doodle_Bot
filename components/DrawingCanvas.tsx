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
}

export const DrawingCanvas = forwardRef<CanvasHandle, DrawingCanvasProps>(
  ({ disabled = false }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawingRef = useRef<boolean>(false);
    const isDirtyRef = useRef<boolean>(false);
    const strokeHistoryRef = useRef<ImageData[]>([]);
    const [canUndo, setCanUndo] = useState(false);

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

    // Scaling for high DPI screens & maintaining backing store contents across resizes
    const setupCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const newWidth = Math.floor(rect.width * dpr);
      const newHeight = Math.floor(rect.height * dpr);

      if (canvas.width === newWidth && canvas.height === newHeight) return;

      // Preserve previous drawing during resize / orientation change
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

      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0A0A0A";
        ctx.lineWidth = 5;

        // White background
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, rect.width, rect.height);

        // Restore saved content scaled to new dimensions if present
        if (tempCanvas) {
          ctx.drawImage(tempCanvas, 0, 0, rect.width, rect.height);
        }
      }
    }, []);

    useEffect(() => {
      setupCanvas();

      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver(() => {
        setupCanvas();
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, [setupCanvas]);

    // Pointer events with full touch neutralization
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}

      isDrawingRef.current = true;
      isDirtyRef.current = true;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      saveState();

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current || disabled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      ctx.lineTo(x, y);
      ctx.stroke();
      isDirtyRef.current = true;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          if (canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
      }
      isDrawingRef.current = false;
    };

    const clearCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      if (canvas.width === 0 || canvas.height === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0A0A0A";
      ctx.lineWidth = 5;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, rect.width, rect.height);

      isDirtyRef.current = true;
      strokeHistoryRef.current = [];
      setCanUndo(false);
      saveState();
    }, [saveState]);

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
        <div
          ref={containerRef}
          className="relative flex-1 w-full rounded-2xl overflow-hidden border-2 border-ieee-blue/30 bg-white shadow-inner"
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full cursor-crosshair touch-none select-none"
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
            <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center">
              <span className="font-semibold text-ink-muted">Canvas locked</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between gap-3 mt-3 px-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo || disabled}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-ink-muted bg-surface-muted hover:bg-surface-muted/80 rounded-lg disabled:opacity-40 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Undo
          </button>

          <button
            type="button"
            onClick={clearCanvas}
            disabled={disabled}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-urgent bg-urgent/10 hover:bg-urgent/20 rounded-lg disabled:opacity-40 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear Canvas
          </button>
        </div>
      </div>
    );
  }
);

DrawingCanvas.displayName = "DrawingCanvas";
