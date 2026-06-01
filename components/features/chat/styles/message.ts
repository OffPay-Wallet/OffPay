import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export const messageStyles = StyleSheet.create({
  messageList: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  messageRow: {
    flexDirection: 'row',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAgent: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '88%',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  userBubble: {
    backgroundColor: colors.brand.deepShadow,
    borderColor: 'rgba(16, 16, 16, 0.14)',
  },
  agentBubble: {
    backgroundColor: colors.glass.strongFill,
    borderColor: colors.glass.rim,
  },
  messageHeaderRow: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  messageMeta: {
    fontFamily: fontFamily.uiMedium,
  },
  messageText: {
    fontFamily: fontFamily.ui,
  },
});
