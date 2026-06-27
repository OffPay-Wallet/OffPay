import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { HEADER_BUTTON_SIZE } from '../constants';

const DRAWER_SHADOW = '12px 0 38px rgba(0, 0, 0, 0.62), inset 0 1px 1px rgba(255, 255, 255, 0.1)';

export const drawerStyles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  drawerPanel: {
    alignSelf: 'stretch',
    backgroundColor: colors.brand.graphiteDepth,
    borderTopRightRadius: radii['2xl'],
    borderBottomRightRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    fontSize: 23,
    lineHeight: 27,
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
    backgroundColor: colors.surface.solidControl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.08)',
  },
  drawerIconButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: colors.surface.solidControlPressed,
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
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    boxShadow: '0 10px 22px rgba(0, 0, 0, 0.42)',
  },
  newChatRowPressed: {
    transform: [{ scale: 0.985 }],
    backgroundColor: colors.surface.glossPressed,
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
    paddingTop: spacing.md,
  },
  drawerListContent: {
    paddingTop: 0,
    paddingBottom: spacing.xl,
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
    minHeight: 80,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    fontFamily: fontFamily.ui,
    backgroundColor: colors.surface.solidCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  drawerRow: {
    minHeight: 72,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface.solidCardElevated,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.05)',
  },
  drawerRowActive: {
    borderColor: 'rgba(247, 247, 242, 0.22)',
    backgroundColor: colors.surface.solidControl,
  },
  drawerRowMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  drawerRowPressed: {
    transform: [{ scale: 0.985 }],
    backgroundColor: colors.surface.solidControl,
    borderColor: 'rgba(247, 247, 242, 0.18)',
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
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: spacing.sm,
  },
  drawerMiniButton: {
    width: 32,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerMiniButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.68,
  },
});
