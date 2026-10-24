import { useEffect, useRef, type ReactNode } from "react";

import type { StyleId } from "../lib/appearance";
import type { BrandMode, BrandPaletteName, ColorSetValues } from "../lib/brand";
import { applyTokens, tokensFor } from "../lib/tokens";

/**
 * A box that shows its content with the tokens of another style, mode, palette and colour set.
 * Only a picture: hidden from screen readers and not focusable (inert), its buttons do nothing.
 * The colours go on as CSS variables through the DOM (no inline style attribute, CSP stays strict).
 */
export function TokenPreview({
  style,
  mode,
  palette,
  colorSet,
  children,
  className,
}: {
  style: StyleId;
  mode: BrandMode;
  palette: BrandPaletteName;
  /** Default: the built-in "Orange". */
  colorSet?: ColorSetValues;
  children: ReactNode;
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current !== null) applyTokens(ref.current, tokensFor(style, mode, palette, colorSet));
  }, [style, mode, palette, colorSet]);
  return (
    <div ref={ref} className={className} aria-hidden="true" inert>
      {children}
    </div>
  );
}
