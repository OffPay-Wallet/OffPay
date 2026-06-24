import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { PROMPT_ICON_SIZE, PROMPT_INPUT_ROW_MIN_HEIGHT } from '../constants';

const COMPOSER_SHADOW =
  '0 14px 32px rgba(0, 0, 0, 0.52), inset 0 1px 1px rgba(255, 255, 255, 0.16), inset 0 -1px 2px rgba(0, 0, 0, 0.35)';

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
    backgroundColor: colors.surface.cardElevated,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: COMPOSER_SHADOW,
  },
  promptInputRow: {
    minHeight: PROMPT_INPUT_ROW_MIN_HEIGHT,
    justifyContent: 'center',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
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
  },
  promptAccessory: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
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
    opacity: 0.88,
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
    opacity: 0.88,
  },

  voiceCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
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
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
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
  voiceControlDisabled: {
    opacity: 0.5,
  },
});
