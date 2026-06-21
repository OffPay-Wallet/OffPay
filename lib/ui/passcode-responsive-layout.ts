import { layout, spacing } from '@/constants/spacing';
import { getViewportProfile } from '@/lib/ui/responsive-layout';

export interface PasscodeResponsiveLayoutInput {
  width: number;
  height: number;
  fontScale?: number;
  topInset?: number;
  bottomInset?: number;
  footerReserve?: number;
}

export interface PasscodeResponsiveLayout {
  horizontalPadding: number;
  contentMaxWidth: number;
  contentGap: number;
  keypadGap: number;
  keySize: number;
  keyFontSize: number;
  titleFontSize: number;
  titleLineHeight: number;
  subtitleFontSize: number;
  dotSize: number;
  dotGap: number;
  verticalPadding: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getPasscodeResponsiveLayout({
  width,
  height,
  fontScale = 1,
  topInset = 0,
  bottomInset = 0,
  footerReserve = 0,
}: PasscodeResponsiveLayoutInput): PasscodeResponsiveLayout {
  const viewport = getViewportProfile({ width, height, fontScale, topInset, bottomInset });
  const horizontalPadding = viewport.horizontalPadding;
  const usableWidth = Math.max(0, width - horizontalPadding * 2);
  const usableHeight = Math.max(0, viewport.usableHeight - footerReserve);
  const keypadGap = viewport.ultraDense ? 12 : viewport.dense ? 14 : viewport.compact ? 16 : 18;
  const contentGap = viewport.ultraDense ? 18 : viewport.dense ? 20 : viewport.compact ? 22 : 24;
  const dotSize = viewport.ultraDense ? 15 : viewport.dense ? 16 : viewport.compact ? 17 : 18;
  const dotGap = viewport.ultraDense ? 9 : viewport.dense ? 10 : viewport.compact ? 11 : 12;
  const titleFontSize = viewport.ultraDense ? 28 : viewport.dense ? 30 : viewport.compact ? 32 : 34;
  const titleLineHeight = titleFontSize + (viewport.ultraDense ? 6 : 8);
  const subtitleFontSize = viewport.ultraDense ? 13 : 14;
  const keypadMaxWidth = Math.min(
    usableWidth,
    viewport.ultraDense ? 252 : viewport.dense ? 276 : viewport.compact ? 300 : 312,
  );
  const targetMaxKeySize = viewport.ultraDense
    ? 64
    : viewport.dense
      ? 70
      : viewport.compact
        ? 76
        : 80;
  const copyBlockHeight = titleLineHeight + spacing.sm + Math.ceil(subtitleFontSize * 1.45);
  const inlineActionReserve = footerReserve > 0 ? 0 : layout.minTouchTarget;
  const verticalPadding = viewport.ultraDense
    ? spacing.md
    : viewport.dense
      ? spacing.lg
      : spacing.xl;
  const fixedHeight =
    copyBlockHeight + dotSize + inlineActionReserve + contentGap * 3 + verticalPadding * 2;
  const widthLimitedKeySize = Math.floor((keypadMaxWidth - keypadGap * 2) / 3);
  const heightLimitedKeySize = Math.floor(
    (Math.max(layout.minTouchTarget * 4, usableHeight - fixedHeight) - keypadGap * 3) / 4,
  );
  const keySize = clamp(
    Math.min(targetMaxKeySize, widthLimitedKeySize, heightLimitedKeySize),
    layout.minTouchTarget,
    targetMaxKeySize,
  );
  const contentMaxWidth = Math.min(usableWidth, keySize * 3 + keypadGap * 2);

  return {
    horizontalPadding,
    contentMaxWidth,
    contentGap,
    keypadGap,
    keySize,
    keyFontSize: clamp(Math.floor(keySize * 0.38), 24, 34),
    titleFontSize,
    titleLineHeight,
    subtitleFontSize,
    dotSize,
    dotGap,
    verticalPadding,
  };
}
