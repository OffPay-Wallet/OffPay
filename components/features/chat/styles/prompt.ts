import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { PROMPT_ICON_SIZE, PROMPT_INPUT_ROW_MIN_HEIGHT } from '../constants';

const COMPOSER_SHADOW =
  '0 16px 34px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.12), inset 0 -1px 2px rgba(0, 0, 0, 0.36)';

export const promptStyles = StyleSheet.create({
  promptDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    paddingTop: spacing.sm,
  },
  prompt: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.solidCardElevated,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    boxShadow: COMPOSER_SHADOW,
  },
  promptPressed: {
    transform: [{ scale: 0.997 }],
    backgroundColor: colors.surface.solidControl,
  },
  promptInputRow: {
    minHeight: PROMPT_INPUT_ROW_MIN_HEIGHT,
    justifyContent: 'center',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.backgroundAlt,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  promptInput: {
    fontFamily: fontFamily.ui,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text.primary,
    padding: 0,
    maxHeight: 120,
  },
  promptActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  promptActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  promptAccessory: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.solidControl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  promptAccessoryPressed: {
    transform: [{ scale: 0.93 }],
    backgroundColor: colors.surface.solidControlPressed,
  },
  voiceOrb: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: PROMPT_ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  voiceOrbPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.9,
  },
  promptSend: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: PROMPT_ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  promptSendDisabled: {
    backgroundColor: colors.glass.strongFill,
    borderColor: colors.glass.rimSubtle,
  },
  promptSendPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.88,
  },

  voiceCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.solidCardElevated,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    boxShadow: COMPOSER_SHADOW,
  },
  voiceTranscript: {
    fontFamily: fontFamily.ui,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text.primary,
    minHeight: 24,
  },
  voiceTranscriptPlaceholder: {
    fontFamily: fontFamily.ui,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text.placeholder,
    minHeight: 24,
  },
  voiceWaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  voiceControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  voiceControlNeutral: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.solidControl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  voiceControlNeutralPressed: {
    transform: [{ scale: 0.93 }],
    backgroundColor: colors.surface.solidControlPressed,
  },
  voiceControlPrimary: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  voiceControlPrimaryPressed: {
    transform: [{ scale: 0.93 }],
    opacity: 0.9,
  },
  voiceControlDisabled: {
    opacity: 0.5,
  },
});
