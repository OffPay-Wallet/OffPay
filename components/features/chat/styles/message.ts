import { StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import { CHAT_BUBBLE_OPPOSITE_GUTTER, CHAT_BUBBLE_TAIL_RADIUS } from '../constants';

/** Shared corner radius for three rounded corners on each bubble. */
const BUBBLE_RADIUS = radii.lg;

export const messageStyles = StyleSheet.create({
  messageList: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
    paddingLeft: CHAT_BUBBLE_OPPOSITE_GUTTER,
  },
  messageRowAgent: {
    justifyContent: 'flex-start',
    paddingRight: CHAT_BUBBLE_OPPOSITE_GUTTER,
  },
  chatBubble: {
    maxWidth: '100%',
    flexShrink: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderCurve: 'continuous',
  },
  chatBubbleUser: {
    backgroundColor: colors.brand.whiteStream,
    borderTopLeftRadius: BUBBLE_RADIUS,
    borderTopRightRadius: BUBBLE_RADIUS,
    borderBottomLeftRadius: BUBBLE_RADIUS,
    borderBottomRightRadius: CHAT_BUBBLE_TAIL_RADIUS,
  },
  chatBubbleAgent: {
    backgroundColor: colors.brand.graphiteDepth,
    borderTopLeftRadius: BUBBLE_RADIUS,
    borderTopRightRadius: BUBBLE_RADIUS,
    borderBottomLeftRadius: CHAT_BUBBLE_TAIL_RADIUS,
    borderBottomRightRadius: BUBBLE_RADIUS,
  },
  bubbleTextUser: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
    color: colors.brand.deepShadow,
  },
  bubbleTextAgent: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
    color: colors.brand.whiteStream,
  },
  agentThinkingInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  agentStreamInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    flexShrink: 1,
  },
  agentLoaderSlot: {
    width: 20,
    height: 20,
    flexShrink: 0,
  },
  thinkingStatusText: {
    fontFamily: fontFamily.ui,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
    color: colors.text.secondary,
  },
  streamText: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 21,
    flexShrink: 1,
    color: colors.brand.whiteStream,
  },
  agentMessageStack: {
    maxWidth: '100%',
    flexShrink: 1,
  },
  actionCardWrap: {
    marginTop: spacing.sm,
    maxWidth: '100%',
    flexShrink: 1,
  },
  toolCardWrap: {
    marginTop: spacing.sm,
    maxWidth: '100%',
    flexShrink: 1,
  },
});
