import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const confirmationStyles = StyleSheet.create({
  confirmationCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    minWidth: 0,
    backgroundColor: colors.surface.solidCardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xl,
    gap: spacing.xl,
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  },
  confirmationCardCompact: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  confirmationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  confirmationTitleStack: {
    flex: 1,
    minWidth: 0,
  },
  confirmationTitle: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  confirmationRows: {
    gap: spacing.sm,
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    minHeight: 30,
  },
  confirmationRowLabel: {
    width: 82,
    flexShrink: 0,
  },
  confirmationRowValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: fontFamily.uiSemiBold,
  },
  confirmationRowValueLink: {
    textDecorationLine: 'underline',
  },
  confirmationRowLink: {
    flex: 1,
  },
  confirmationRowLinkPressed: {
    opacity: 0.6,
  },
  monoText: {
    fontFamily: fontFamily.mono,
  },
  confirmationError: {
    lineHeight: 16,
  },
  confirmationWarnings: {
    gap: spacing.xs,
  },
  routeChoiceBlock: {
    gap: spacing.xs,
  },
  routeChoice: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: 4,
    borderRadius: radii.full,
    backgroundColor: colors.surface.solidControl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  routeChoiceOption: {
    flex: 1,
    minHeight: 34,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  routeChoiceOptionSelected: {
    backgroundColor: colors.brand.whiteStream,
  },
  routeChoiceOptionPressed: {
    backgroundColor: colors.glass.clearFill,
  },
  routeChoiceText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12,
  },
  routeChoiceTextSelected: {
    color: colors.brand.deepShadow,
  },
  confirmationActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.whiteStream,
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.32)',
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.solidControl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  actionButtonPressed: {
    opacity: 0.78,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
});
