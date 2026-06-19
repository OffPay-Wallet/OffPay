/**
 * Dotted QR code with rounded eye markers and an optional centre logo.
 *
 * Performance design (the previous version emitted ~700 `<Circle>`
 * SVG nodes which each cost a native commit and a JS render — that's
 * what made the receive screen freeze):
 *
 * 1. Generate the QR matrix synchronously via `qrcode.create()`.
 * 2. Collect every filled body module and the three finder patterns
 *    into a single SVG path `d` string. The renderer ships ONE native
 *    node for the whole grid instead of hundreds.
 * 3. Memoise the path string against the inputs that affect geometry,
 *    so re-renders with the same `value` / `size` are essentially
 *    free.
 * 4. Wrap the entire component in `React.memo` so unrelated parent
 *    state (Umbra hooks, claim probes, etc.) cannot trigger a
 *    rebuild.
 *
 * The error-correction level is `H` (≈30%) so we can punch out the
 * centre for the optional logo without breaking scanability.
 */
import React, { memo, useMemo } from 'react';
import { Image as RNImage, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle as SvgCircle, Path, Rect } from 'react-native-svg';
// `qrcode` ships JS only and has no ESM build, so a `require()`
// keeps the bundle smaller than a wildcard interop import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qrcode = require('qrcode') as {
  create: (
    data: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ) => {
    modules: { size: number; get: (row: number, col: number) => number | boolean };
  };
};

export interface DottedQRCodeProps {
  /** Encoded payload. */
  value: string;
  /** Pixel size of the rendered QR (square). */
  size: number;
  /** Foreground colour for dots and finder patterns. */
  color?: string;
  /** Background colour beneath the dots. */
  backgroundColor?: string;
  /** Optional logo image source rendered in the centre. */
  logo?: number;
  /** Background plate behind the centre logo. */
  logoPlateColor?: string;
  /** Override automatic logo size (defaults to ~22% of QR size). */
  logoSize?: number;
  /** Container style. */
  style?: StyleProp<ViewStyle>;
}

const FINDER_SIZE = 7; // QR finder patterns are always 7x7 modules.

/**
 * SVG path snippet that draws a filled circle. Two arc commands trace
 * the circumference; using arcs (rather than two semicircles via
 * `<Circle>`) lets us fold every body module into a single `d` string.
 */
function circleSubpath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

/**
 * Rounded rectangle outline (stroked) — used for the outer ring of
 * each finder pattern.
 */
function roundedRectOutlineSubpath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, Math.min(width, height) / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `A ${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + height - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

function isPointInsideCircle(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

interface MatrixSnapshot {
  size: number;
  bits: Uint8Array;
}

interface FinderRegion {
  row: number;
  col: number;
}

function buildMatrixSnapshot(value: string): MatrixSnapshot | null {
  if (value.length === 0) return null;
  try {
    const result = qrcode.create(value, { errorCorrectionLevel: 'H' });
    const moduleCount = result.modules.size;
    // Cache the matrix as a flat byte array so the path-building loop
    // doesn't reach back into `qrcode`'s internal getter (~3x faster
    // tight-loop access on Hermes).
    const bits = new Uint8Array(moduleCount * moduleCount);
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        bits[row * moduleCount + col] = result.modules.get(row, col) ? 1 : 0;
      }
    }
    return { size: moduleCount, bits };
  } catch {
    return null;
  }
}

function isInsideFinder(row: number, col: number, region: FinderRegion): boolean {
  return (
    row >= region.row &&
    row < region.row + FINDER_SIZE &&
    col >= region.col &&
    col < region.col + FINDER_SIZE
  );
}

function buildPathData(params: {
  matrix: MatrixSnapshot;
  pixelSize: number;
  hasLogo: boolean;
  logoSize: number;
}): { dotsPath: string; finderFillPath: string; finderStrokePath: string } {
  const { matrix, pixelSize, hasLogo, logoSize } = params;
  const moduleCount = matrix.size;
  const moduleSize = pixelSize / moduleCount;
  const dotRadius = moduleSize * 0.42;

  const finderRegions: FinderRegion[] = [
    { row: 0, col: 0 },
    { row: 0, col: moduleCount - FINDER_SIZE },
    { row: moduleCount - FINDER_SIZE, col: 0 },
  ];

  const logoCenter = pixelSize / 2;
  const logoRadius = logoSize / 2;

  const dotPieces: string[] = [];
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (matrix.bits[row * moduleCount + col] === 0) continue;
      // Skip finder modules — drawn separately as concentric rings.
      let inFinder = false;
      for (let f = 0; f < finderRegions.length; f += 1) {
        if (isInsideFinder(row, col, finderRegions[f])) {
          inFinder = true;
          break;
        }
      }
      if (inFinder) continue;
      const cx = col * moduleSize + moduleSize / 2;
      const cy = row * moduleSize + moduleSize / 2;
      // Skip only the circular logo plate, not a square block. The
      // plate itself is drawn later, so its visible edge stays round
      // while level-H ECC covers the occluded modules.
      if (hasLogo && isPointInsideCircle(cx, cy, logoCenter, logoCenter, logoRadius)) {
        continue;
      }
      dotPieces.push(circleSubpath(cx, cy, dotRadius));
    }
  }

  // Finder geometry — outer ring (stroke) + solid centre dot (fill).
  const outerStroke = moduleSize;
  const outerRadius = moduleSize * 1.4;
  const finderDotRadius = ((FINDER_SIZE - 4) * moduleSize) / 2;

  const strokePieces: string[] = [];
  const fillPieces: string[] = [];
  for (let f = 0; f < finderRegions.length; f += 1) {
    const region = finderRegions[f];
    const baseX = region.col * moduleSize;
    const baseY = region.row * moduleSize;
    const ringSize = FINDER_SIZE * moduleSize;
    strokePieces.push(
      roundedRectOutlineSubpath(
        baseX + outerStroke / 2,
        baseY + outerStroke / 2,
        ringSize - outerStroke,
        ringSize - outerStroke,
        outerRadius,
      ),
    );
    const dotCx = baseX + (FINDER_SIZE / 2) * moduleSize;
    const dotCy = baseY + (FINDER_SIZE / 2) * moduleSize;
    fillPieces.push(circleSubpath(dotCx, dotCy, finderDotRadius));
  }

  return {
    dotsPath: dotPieces.join(' '),
    finderFillPath: fillPieces.join(' '),
    finderStrokePath: strokePieces.join(' '),
  };
}

function DottedQRCodeImpl({
  value,
  size,
  color = '#000000',
  backgroundColor = '#FFFFFF',
  logo,
  logoPlateColor,
  logoSize,
  style,
}: DottedQRCodeProps): React.JSX.Element | null {
  const matrix = useMemo(() => buildMatrixSnapshot(value), [value]);
  const resolvedLogoSize = logoSize ?? Math.round(size * 0.22);

  const paths = useMemo(() => {
    if (matrix == null) return null;
    return buildPathData({
      matrix,
      pixelSize: size,
      hasLogo: logo != null,
      logoSize: resolvedLogoSize,
    });
  }, [logo, matrix, resolvedLogoSize, size]);

  if (matrix == null || paths == null) return null;

  const moduleSize = size / matrix.size;
  const finderOuterStroke = moduleSize;
  const logoCenter = size / 2;
  const logoOrigin = (size - resolvedLogoSize) / 2;
  const logoRadius = resolvedLogoSize / 2;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Rect x={0} y={0} width={size} height={size} fill={backgroundColor} />
        {/* Single-path rendering: every body dot rolled into one
            `<Path>` element so the SVG ships a single native node
            instead of ~700. */}
        {paths.dotsPath.length > 0 ? <Path d={paths.dotsPath} fill={color} /> : null}
        {paths.finderStrokePath.length > 0 ? (
          <Path
            d={paths.finderStrokePath}
            stroke={color}
            strokeWidth={finderOuterStroke}
            fill="none"
          />
        ) : null}
        {paths.finderFillPath.length > 0 ? <Path d={paths.finderFillPath} fill={color} /> : null}
        {logo != null ? (
          <SvgCircle
            cx={logoCenter}
            cy={logoCenter}
            r={logoRadius}
            fill={logoPlateColor ?? backgroundColor}
          />
        ) : null}
      </Svg>
      {logo != null ? (
        <View
          pointerEvents="none"
          style={[
            styles.logoOverlay,
            {
              width: resolvedLogoSize,
              height: resolvedLogoSize,
              borderRadius: logoRadius,
              left: logoOrigin,
              top: logoOrigin,
              backgroundColor: logoPlateColor ?? backgroundColor,
            },
          ]}
        >
          <RNImage source={logo} resizeMode="cover" style={styles.logoImage} />
        </View>
      ) : null}
    </View>
  );
}

export const DottedQRCode = memo(DottedQRCodeImpl);

const styles = StyleSheet.create({
  logoOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
});
