import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const payrollStyles = StyleSheet.create({
  card: {
    borderRadius: spacing.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: '0 2px 10px rgba(14, 42, 53, 0.08)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    color: colors.text.primary,
    flexShrink: 1,
  },
  sourceName: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.text.secondary,
    flexShrink: 1,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    minWidth: 92,
    gap: 2,
  },
  statLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    color: colors.text.primary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.glass.frostFill,
  },
  badgeText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12,
    color: colors.text.primary,
  },
  warningText: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.semantic.warning,
  },
  claimNote: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.text.secondary,
  },
  typedConfirmInput: {
    height: 44,
    borderRadius: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    color: colors.text.primary,
    backgroundColor: colors.brand.whiteStream,
  },
  primaryButton: {
    height: 48,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.deepShadow,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  primaryButtonDisabled: {
    backgroundColor: 'rgba(14, 42, 53, 0.4)',
  },
  primaryButtonText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    color: colors.brand.whiteStream,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  secondaryButtonText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 14,
    color: colors.text.primary,
  },
  // Row preview list
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.holdingsCard.divider,
  },
  rowLabel: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 14,
    color: colors.text.primary,
  },
  rowRecipient: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.text.secondary,
  },
  rowAmount: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 14,
    color: colors.text.primary,
  },
  rowStatus: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
  },
  rowError: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.semantic.error,
    flexShrink: 1,
  },
});
