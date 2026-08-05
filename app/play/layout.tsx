import type { Viewport } from "next";
import type { ReactNode } from "react";

/**
 * Zoom is locked on the game route only — a double-tap-to-zoom mid-round is indistinguishable
 * from a stroke. This lives in a layout because app/play/page.tsx is a client component, and
 * client components cannot export `viewport` or `metadata`.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function PlayLayout({ children }: { children: ReactNode }) {
  return children;
}
