import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

import {
  AgenticActionCard,
  type AgenticTransactionAction,
} from './AgenticActionCard';
import { actionCardMorphEnter, actionCardMorphExit } from './action-card-motion';

import type { AgenticChatAction, AgenticPrivateSendAction } from '@/store/agenticChatStore';

interface AgenticActionDraftSheetProps {
  action: AgenticTransactionAction | null;
  bottomOffset: number;
  horizontalPadding: number;
  maxHeight: number;
  onConfirm: (action: AgenticChatAction) => void;
  onCancel: (action: AgenticChatAction) => void;
  onRouteChange: (
    action: AgenticPrivateSendAction,
    route: AgenticPrivateSendAction['route'],
  ) => void;
}

const ACTION_SHEET_LAYOUT = LinearTransition.duration(210);
const SHEET_GRADIENT_COLORS = [
  colors.holdingsCard.gradientTop,
  colors.holdingsCard.gradientMid,
  colors.holdingsCard.gradientBottom,
] as const;

export function AgenticActionDraftSheet({
  action,
  bottomOffset,
  horizontalPadding,
  maxHeight,
  onConfirm,
  onCancel,
  onRouteChange,
}: AgenticActionDraftSheetProps): React.JSX.Element | null {
  if (action == null) return null;

  return (
    <Animated.View pointerEvents="box-none" style={styles.layer}>
      <Animated.View
        pointerEvents="none"
        entering={FadeIn.duration(140)}
        exiting={FadeOut.duration(140)}
        style={styles.backdrop}
      />
      <Animated.View
        entering={actionCardMorphEnter}
        exiting={actionCardMorphExit}
        layout={ACTION_SHEET_LAYOUT}
        style={[
          styles.sheet,
          {
            bottom: bottomOffset,
            paddingHorizontal: horizontalPadding,
          },
        ]}
      >
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ maxHeight }}
          contentContainerStyle={styles.scrollContent}
        >
          <LinearGradient
            colors={SHEET_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sheetSurface}
          >
            <View style={styles.grabber} />
            <AgenticActionCard
              action={action}
              onConfirm={onConfirm}
              onCancel={onCancel}
              onRouteChange={onRouteChange}
            />
          </LinearGradient>
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  scrollContent: {
    paddingBottom: spacing.xs,
  },
  sheetSurface: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.solidCardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.sm,
    gap: spacing.xs,
    boxShadow: '0 18px 42px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glass.rim,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
});
