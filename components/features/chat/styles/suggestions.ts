import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const suggestionStyles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  privacyHint: {
    fontFamily: fontFamily.uiMedium,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(16, 16, 16, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(16, 16, 16, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: {
    opacity: 0.74,
    backgroundColor: colors.glass.strongFill,
  },
});
