import { useMemo } from "react";
import Svg, { Defs, G, Mask, Rect } from "react-native-svg";

import { APP_LOGO_SPEC, validateLogoSpec } from "../../../shared/brand/logoSpec";
import { LogoShapeElement } from "@/components/brand-animation/logo-shapes";
import { brandMask } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

/**
 * A logo of the logo library as a still image in the accent colour: only the checked spec is
 * drawn (never SVG text). Anything that doesn't pass the check shows the built-in app logo.
 */
export function LogoMark({ spec: specIn, size, label }: { spec: unknown; size: number; label: string }) {
  const { colors } = useTheme();
  const spec = useMemo(() => {
    const checked = validateLogoSpec(specIn);
    return checked.ok ? checked.spec : APP_LOGO_SPEC;
  }, [specIn]);
  const [x, y, w, h] = spec.viewBox;
  return (
    <Svg width={size} height={size} viewBox={spec.viewBox.join(" ")} accessible accessibilityLabel={label} accessibilityRole="image">
      <Defs>
        <Mask id="logoMarkMask" maskUnits="userSpaceOnUse" x={x} y={y} width={w} height={h}>
          <Rect x={x} y={y} width={w} height={h} fill={brandMask.hide} />
          {spec.shapes.map((shape, i) =>
            shape.role === "stroke" ? null : (
              <LogoShapeElement key={i} shape={shape} paint={{ fill: shape.role === "fill" ? brandMask.show : brandMask.hide }} />
            ),
          )}
        </Mask>
      </Defs>
      <G mask="url(#logoMarkMask)">
        <Rect x={x} y={y} width={w} height={h} fill={colors.accent} />
      </G>
      {spec.shapes.map((shape, i) =>
        shape.role === "stroke" ? (
          <LogoShapeElement key={i} shape={shape} paint={{ fill: "none", stroke: colors.accent, strokeWidth: shape.strokeWidth ?? 2 }} />
        ) : null,
      )}
    </Svg>
  );
}
