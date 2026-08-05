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
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawingRef = useRef<boolean>(false);
    const isDirtyRef = useRef<boolean>(false);
    const strokeHistoryRef = useRef<ImageData[]>([]);
    const [canUndo, setCanUndo] = useState(false);

    // Scaling for high DPI screens
    const setupCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0A0A0A"; // Black ink on white
        ctx.lineWidth = 5;

        // White background
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
    }, []);

    useEffect(() => {
      setupCanvas();

      const handleResize = () => {
        // Redraw content if resized
        const canvas = canvasRef.current;
        if (!canvas) return;
        setupCanvas();
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, [setupCanvas]);

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

    // Pointer events for mobile + desktop
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(e.pointerId);
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
          canvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
      isDrawingRef.current = false;
    };

    const clearCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (rect.width > 0 && rect.height > 0) {
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
        }
      }

      // Canvas is still hidden (e.g. clear() fired before the "drawing" phase's CSS
      // class change has painted) — nothing to size or snapshot yet. Bail out rather
      // than call getImageData on a zero-size canvas, which throws IndexSizeError.
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

      // Pop current state
      strokeHistoryRef.current.pop();
      // Restore previous state
      const prevState = strokeHistoryRef.current[strokeHistoryRef.current.length - 1];
      if (prevState) {
        ctx.putImageData(prevState, 0, 0);
        isDirtyRef.current = true;
      }
      setCanUndo(strokeHistoryRef.current.length > 1);
    };

    // Implement CanvasHandle ref interface for inference engine
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
        <div className="relative flex-1 w-full rounded-2xl overflow-hidden border-2 border-ieee-blue/30 bg-white shadow-inner">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full canvas-surface cursor-crosshair touch-none select-none"
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
