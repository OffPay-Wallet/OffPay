import { layout, spacing } from '@/constants/spacing';

export interface ViewportProfileInput {
  width: number;
  height: number;
  fontScale?: number;
  topInset?: number;
  bottomInset?: number;
}

export interface ViewportProfile {
  usableHeight: number;
  compact: boolean;
  dense: boolean;
  ultraDense: boolean;
  horizontalPadding: number;
  sectionGap: number;
  bottomActionHeight: number;
}

export function getViewportProfile({
  width,
  height,
  fontScale = 1,
  topInset = 0,
  bottomInset = 0,
}: ViewportProfileInput): ViewportProfile {
  const usableHeight = Math.max(0, height - topInset - bottomInset);
  const compact = width < 390 || usableHeight < 820 || fontScale > 1.05;
  const dense = width < 360 || usableHeight < 740 || fontScale > 1.12;
  const ultraDense = width < 340 || usableHeight < 680 || fontScale > 1.24;

  return {
    usableHeight,
    compact,
    dense,
    ultraDense,
    horizontalPadding: ultraDense
      ? spacing.md
      : dense
        ? spacing.lg
        : compact
          ? spacing.lg
          : spacing['2xl'],
    sectionGap: ultraDense ? spacing.sm : dense ? spacing.md : compact ? spacing.lg : spacing.xl,
    bottomActionHeight: dense ? layout.buttonHeightMd : layout.buttonHeightLg,
  };
}

export function getResponsiveFooterBottomPadding(bottomInset: number, dense: boolean): number {
  return Math.max(bottomInset, dense ? spacing.sm : spacing.lg);
}
