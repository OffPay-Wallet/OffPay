/**
 * Typography tokens for OffPay.
 *
 * Font files: assets/fonts/
 * Embedded via the expo-font config plugin in app.config.ts.
 */
import { Platform } from 'react-native';

import type { TextStyle } from 'react-native';

/**
 * Font family names — match the embedded native asset family names.
 * Keep the legacy weight keys for existing call sites, and use the role
 * keys for new UI work.
 */
export const fontFamily = {
  /** Quicksand — warm display/headline moments */
  display: 'Quicksand-Bold',
  displaySemiBold: 'Quicksand-SemiBold',
  /** Cirka — numeric financial display */
  moneyLight: 'Cirka-Light',
  money: 'Cirka-Bold',
  moneyBold: 'Cirka-Bold',
  /** Geist — primary product UI */
  ui: 'Geist-Regular',
  uiMedium: 'Geist-Medium',
  uiSemiBold: 'Geist-SemiBold',
  uiBold: 'Geist-Bold',
  /** Geist Mono — addresses, hashes, technical values */
  mono: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
  monoSemiBold: 'GeistMono-SemiBold',

  /** Legacy aliases */
  bold: 'Quicksand-Bold',
  medium: 'Geist-Medium',
  regular: 'Geist-Regular',
  semiBold: 'Geist-SemiBold',
  systemMono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
} as const;

/**
 * Pre-defined text style variants.
 * Use these in the <Text> component for consistent typography.
 */
export const textStyles = {
  /** Large balance amounts — 40px bold */
  display: {
    fontFamily: fontFamily.moneyBold,
    fontSize: 40,
    lineHeight: 48,
  } satisfies TextStyle,

  /** Screen titles — 32px bold */
  h1: {
    fontFamily: fontFamily.display,
    fontSize: 32,
    lineHeight: 40,
  } satisfies TextStyle,

  /** Section headers — 24px bold */
  h2: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 24,
    lineHeight: 32,
  } satisfies TextStyle,

  /** Subsection headers — 20px semibold */
  h3: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 20,
    lineHeight: 28,
  } satisfies TextStyle,

  /** Body text — 16px regular */
  body: {
    fontFamily: fontFamily.ui,
    fontSize: 16,
    lineHeight: 24,
  } satisfies TextStyle,

  /** Body text bold — 16px semibold */
  bodyBold: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 24,
  } satisfies TextStyle,

  /** Labels, descriptions — 14px regular */
  caption: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    lineHeight: 20,
  } satisfies TextStyle,

  /** Caption bold — 14px medium */
  captionBold: {
    fontFamily: fontFamily.uiMedium,
    fontSize: 14,
    lineHeight: 20,
  } satisfies TextStyle,

  /** Small text — 12px regular */
  small: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 16,
  } satisfies TextStyle,

  /** Button text — 16px semibold */
  button: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 20,
  } satisfies TextStyle,

  /** Button text small — 14px semibold */
  buttonSmall: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 14,
    lineHeight: 18,
  } satisfies TextStyle,

  /** Monospace — addresses, hashes, amounts in lists */
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    lineHeight: 20,
  } satisfies TextStyle,

  /** Money — balances, token quantities, fiat values */
  money: {
    fontFamily: fontFamily.moneyBold,
    fontSize: 16,
    lineHeight: 22,
  } satisfies TextStyle,
} as const;

/** Text variant names — union type for component props */
export type TextVariant = keyof typeof textStyles;
