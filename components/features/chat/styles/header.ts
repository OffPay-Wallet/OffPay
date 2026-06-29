import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { HEADER_BUTTON_SIZE } from '../constants';

export const headerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface.background,
  },
  chatBody: {
    flex: 1,
    position: 'relative',
  },
  chatScroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  messageBottomAnchor: {
    flexGrow: 1,
    minHeight: spacing.md,
  },
  payrollErrorWrap: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyCtaWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: spacing['4xl'],
  },
  payrollCardWrap: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerButton: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    borderRadius: HEADER_BUTTON_SIZE / 2,
    backgroundColor: colors.glass.strongFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  headerButtonPressed: {
    opacity: 0.78,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamily.display,
    textAlign: 'center',
  },
  welcomeRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  welcomeAvatar: {
    borderRadius: 999,
    backgroundColor: colors.glass.strongFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  welcomeText: {
    flex: 1,
    gap: 2,
  },
  welcomeEyebrow: {
    fontFamily: fontFamily.moneyLight,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  welcomeName: {
    fontFamily: fontFamily.moneyBold,
    fontSize: 28,
    lineHeight: 32,
  },
  welcomeCredits: {
    marginTop: 2,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  welcomeCreditsLow: {
    color: colors.semantic.warning,
  },
  welcomeCreditsEmpty: {
    color: colors.semantic.error,
  },
  intro: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  introTitle: {
    fontFamily: fontFamily.display,
  },
});
