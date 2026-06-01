import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { PROMPT_ICON_SIZE } from '../constants';

export const promptStyles = StyleSheet.create({
  promptDock: {
    paddingTop: spacing.sm,
  },
  // Rounded card: input/placeholder on the top row, action controls beneath.
  prompt: {
    borderRadius: spacing.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '0 6px 20px rgba(16, 16, 16, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  // Top row holds the multiline text input.
  promptInputRow: {
    minHeight: 28,
    justifyContent: 'center',
  },
  promptInput: {
    fontFamily: fontFamily.ui,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text.primary,
    padding: 0,
    maxHeight: 120,
  },
  // Bottom action row: leading (+) on the left, voice + send on the right.
  promptActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promptActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  promptAccessory: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The dark circular "waveform" button on the right (idle entry to voice).
  voiceOrb: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: PROMPT_ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.deepShadow,
  },
  voiceOrbPressed: {
    opacity: 0.82,
  },
  promptSend: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: PROMPT_ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.deepShadow,
  },
  promptSendDisabled: {
    backgroundColor: 'rgba(16, 16, 16, 0.4)',
  },
  promptSendPressed: {
    opacity: 0.82,
  },

  // --- Voice card (expanded recording / review state) ---
  voiceCard: {
    borderRadius: spacing.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '0 6px 20px rgba(16, 16, 16, 0.10), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
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
    borderRadius: spacing.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 16, 16, 0.08)',
  },
  voiceControlPrimary: {
    width: PROMPT_ICON_SIZE,
    height: PROMPT_ICON_SIZE,
    borderRadius: spacing.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
  },
  voiceControlDisabled: {
    opacity: 0.5,
  },
});
