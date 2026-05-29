import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { HEADER_BUTTON_SIZE } from '../constants';

export const drawerStyles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(14, 42, 53, 0.18)',
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  drawerPanel: {
    height: '100%',
    backgroundColor: colors.brand.whiteStream,
    borderTopRightRadius: radii['2xl'],
    borderBottomRightRadius: radii['2xl'],
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '12px 0 32px rgba(14, 42, 53, 0.16)',
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
  },
  drawerTitle: {
    fontFamily: fontFamily.display,
  },
  drawerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14, 42, 53, 0.06)',
  },
  newChatButton: {
    minHeight: 46,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(46, 174, 210, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(46, 174, 210, 0.22)',
  },
  newChatLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  drawerList: {
    flex: 1,
  },
  drawerListContent: {
    paddingBottom: spacing['2xl'],
    gap: spacing.lg,
  },
  drawerSection: {
    gap: spacing.sm,
  },
  drawerSectionHeader: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  drawerSectionTitle: {
    fontFamily: fontFamily.uiSemiBold,
    textTransform: 'uppercase',
  },
  drawerEmptyText: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  drawerRow: {
    minHeight: 72,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(14, 42, 53, 0.035)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(14, 42, 53, 0.06)',
    overflow: 'hidden',
  },
  drawerRowActive: {
    backgroundColor: 'rgba(46, 174, 210, 0.16)',
    borderColor: 'rgba(46, 174, 210, 0.28)',
  },
  drawerRowMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
  },
  drawerRowPressed: {
    opacity: 0.74,
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
  },
  drawerRowActions: {
    width: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingRight: spacing.xs,
  },
  drawerMiniButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
