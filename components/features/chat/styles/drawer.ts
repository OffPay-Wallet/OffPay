import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { HEADER_BUTTON_SIZE } from '../constants';

const DRAWER_SHADOW =
  '12px 0 36px rgba(0, 0, 0, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.12)';

export const drawerStyles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: colors.surface.backgroundAlt,
    borderTopRightRadius: radii['2xl'],
    borderBottomRightRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: DRAWER_SHADOW,
  },
  drawerChrome: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  drawerHeader: {
    minHeight: HEADER_BUTTON_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  drawerTitleStack: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  drawerTitle: {
    fontFamily: fontFamily.moneyBold,
    fontSize: 24,
    lineHeight: 28,
  },
  drawerSubtitle: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 17,
  },
  drawerIconButton: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  newChatRow: {
    minHeight: 52,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brand.glossAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)',
  },
  newChatLabel: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text.onAccent,
  },
  drawerList: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  drawerListContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing['2xl'],
    gap: spacing.sm,
  },
  drawerSectionHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  drawerSectionTitle: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  drawerEmptyText: {
    paddingVertical: spacing.lg,
    fontFamily: fontFamily.ui,
  },
  drawerRow: {
    minHeight: 72,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    overflow: 'hidden',
  },
  drawerRowActive: {
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.smokeWash,
  },
  drawerRowMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
  },
  drawerRowPressed: {
    opacity: 0.82,
  },
  drawerRowText: {
    minWidth: 0,
    gap: 4,
  },
  drawerRowTitleLine: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  drawerRowTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.uiSemiBold,
  },
  drawerRowPreview: {
    lineHeight: 17,
    fontFamily: fontFamily.ui,
  },
  drawerRowActions: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: spacing.xs,
  },
  drawerMiniButton: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 77, 90, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 77, 90, 0.28)',
  },
});
