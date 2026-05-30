import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const reviewStyles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalsBar: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.md,
    backgroundColor: colors.glass.frostFill,
    marginBottom: spacing.sm,
    gap: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  rowSkipped: {
    opacity: 0.5,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  skipButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.glass.clearFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  skipButtonText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12,
    color: colors.text.primary,
  },
});
