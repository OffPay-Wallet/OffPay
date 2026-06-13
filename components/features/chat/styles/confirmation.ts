import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const confirmationStyles = StyleSheet.create({
  confirmationCard: {
    marginTop: spacing.xs,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    padding: spacing.md,
    gap: spacing.md,
  },
  confirmationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  confirmationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 16, 16, 0.14)',
  },
  confirmationTitleStack: {
    flex: 1,
    minWidth: 0,
  },
  confirmationTitle: {
    fontFamily: fontFamily.uiSemiBold,
  },
  confirmationRows: {
    gap: spacing.xs,
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  confirmationRowLabel: {
    minWidth: 64,
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
    padding: 3,
    borderRadius: radii.full,
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  routeChoiceOption: {
    flex: 1,
    minHeight: 30,
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
    minHeight: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.whiteStream,
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  actionButtonPressed: {
    opacity: 0.78,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
});
