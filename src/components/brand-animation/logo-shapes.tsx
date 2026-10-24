import { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import Animated, { useAnimatedProps, type SharedValue } from "react-native-reanimated";

import { isIdentity, matrixAttribute, pointsAttribute, type LogoShape } from "../../../shared/brand/logoSpec";
import type { BrandFrame } from "../../../shared/brand/timeline";

/** Shared drawing props of a logo shape (colour, outline). Everything else comes from the spec. */
type Paint = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: "round";
  strokeLinejoin?: "round";
  strokeDasharray?: number[];
};

function transformOf(shape: LogoShape): string | undefined {
  return isIdentity(shape.transform) ? undefined : matrixAttribute(shape.transform);
}

/** One shape of a logo spec as a react-native-svg element (never raw SVG text). */
export function LogoShapeElement({ shape, paint }: { shape: LogoShape; paint: Paint }) {
  const transform = transformOf(shape);
  switch (shape.type) {
    case "path":
      return <Path d={shape.d} transform={transform} {...paint} />;
    case "circle":
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} transform={transform} {...paint} />;
    case "ellipse":
      return <Ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} transform={transform} {...paint} />;
    case "rect":
      return (
        <Rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} transform={transform} {...paint} />
      );
    case "line":
      return <Line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} transform={transform} {...paint} />;
    case "polygon":
      return <Polygon points={pointsAttribute(shape.points)} transform={transform} {...paint} />;
    case "polyline":
      return <Polyline points={pointsAttribute(shape.points)} transform={transform} {...paint} />;
  }
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

/**
 * A shape whose outline is drawn: dash = its length, the offset follows the frame (1 -> 0) on the
 * UI thread. `length` is in the shape's own units (shapeLength).
 */
export function OutlineShape({
  shape,
  length,
  frame,
  color,
  strokeWidth,
}: {
  shape: LogoShape;
  length: number;
  frame: SharedValue<BrandFrame>;
  color: string;
  strokeWidth: number;
}) {
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * frame.get().strokeOffset }));
  const transform = transformOf(shape);
  const paint = {
    fill: "none",
    stroke: color,
    strokeWidth: shape.strokeWidth ?? strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: [length, length],
    animatedProps,
  };
  switch (shape.type) {
    case "path":
      return <AnimatedPath d={shape.d} transform={transform} {...paint} />;
    case "circle":
      return <AnimatedCircle cx={shape.cx} cy={shape.cy} r={shape.r} transform={transform} {...paint} />;
    case "ellipse":
      return <AnimatedEllipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} transform={transform} {...paint} />;
    case "rect":
      return (
        <AnimatedRect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} transform={transform} {...paint} />
      );
    case "line":
      return <AnimatedLine x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} transform={transform} {...paint} />;
    case "polygon":
      return <AnimatedPolygon points={pointsAttribute(shape.points)} transform={transform} {...paint} />;
    case "polyline":
      return <AnimatedPolyline points={pointsAttribute(shape.points)} transform={transform} {...paint} />;
  }
}
