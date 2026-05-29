import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { PROMPT_HEIGHT, PROMPT_ICON_SIZE } from '../constants';

export const promptStyles = StyleSheet.create({
  promptDock: {
    paddingTop: spacing.sm,
  },
  prompt: {
    height: PROMPT_HEIGHT,
    borderRadius: PROMPT_HEIGHT / 2,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xl,
    paddingRight: spacing.xs,
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '0 18px 36px rgba(14, 42, 53, 0.16), 0 4px 10px rgba(14, 42, 53, 0.10)',
  },
  promptInput: {
    flex: 1,
    height: '100%',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    color: colors.text.primary,
    padding: 0,
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
    backgroundColor: 'rgba(14, 42, 53, 0.4)',
  },
  promptSendPressed: {
    opacity: 0.82,
  },
});
