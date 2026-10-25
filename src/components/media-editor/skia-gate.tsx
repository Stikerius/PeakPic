import type { ReactNode } from "react";

/** Native: Skia is part of the app, nothing to load. The web version loads CanvasKit first. */
export function SkiaGate({ children }: { children: ReactNode }) {
  return children;
}
