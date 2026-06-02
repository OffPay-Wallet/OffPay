import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import {
  canReadVaultBalance,
  getVaultBalanceForToken,
  getVaultTokenRowLabel,
  type UmbraVaultBalanceLoadState,
} from './umbra-vault-format';

import type {
  UmbraVaultAction,
  UmbraVaultBalance,
  UmbraVaultToken,
  UmbraVaultTokenConfig,
} from './types';

interface UmbraVaultActionPanelProps {
  action: UmbraVaultAction;
  token: UmbraVaultToken;
  tokens: UmbraVaultTokenConfig[];
  balances: UmbraVaultBalance[];
  balanceLoadState: UmbraVaultBalanceLoadState;
  subtitle?: string;
  amount: string;
  loading: boolean;
  loadingLabel?: string;
  disabled: boolean;
  feedbackLabel: string;
  feedbackTone: 'default' | 'danger';
  disabledMessage: string | null;
  maxAmount: string | null;
  onActionChange: (action: UmbraVaultAction) => void;
  onTokenChange: (token: UmbraVaultToken) => void;
  onAmountChange: (amount: string) => void;
  onMaxPress: () => void;
  onSubmit: () => void;
}

const ACTIONS: { id: UmbraVaultAction; title: string }[] = [
  { id: 'shield', title: 'Shield' },
  { id: 'withdraw', title: 'Withdraw' },
];
const ACTION_TRACK_PADDING = 5;
const ACTION_SEGMENT_GAP = 3;
// Snappy spring — the segment thumb slides with a tight, smooth motion.
// Runs entirely on the UI thread, decoupled from the parent re-render.
const ACTION_THUMB_SPRING: WithSpringConfig = {
  damping: 22,
  stiffness: 320,
  mass: 0.7,
};

function getButtonLabel(
  action: UmbraVaultAction,
  token: UmbraVaultToken,
  loading: boolean,
): string {
  if (loading) return 'Submitting';
  return action === 'withdraw' ? `Withdraw ${token}` : `Shield ${token}`;
}

export function UmbraVaultActionPanel({
  action,
  token,
  tokens,
  balances,
  balanceLoadState,
  subtitle,
  amount,
  loading,
  loadingLabel,
  disabled,
  feedbackLabel,
  feedbackTone,
  disabledMessage,
  maxAmount,
  onActionChange,
  onTokenChange,
  onAmountChange,
  onMaxPress,
  onSubmit,
}: UmbraVaultActionPanelProps): React.JSX.Element {
  const { width, height, fontScale } = useWindowDimensions();
  const [actionTrackWidth, setActionTrackWidth] = useState(0);
  const dense = width < 350 || fontScale > 1.18;
  const compact = width < 390 || height < 760 || fontScale > 1.05;
  const actionSegmentHeight = dense ? 32 : 34;
  const actionTrackHeight = actionSegmentHeight + ACTION_TRACK_PADDING * 2;
  const actionSegmentWidth = Math.max(
    0,
    (actionTrackWidth - ACTION_TRACK_PADDING * 2 - ACTION_SEGMENT_GAP) / ACTIONS.length,
  );
  const selectedActionIndex = useMemo(
    () =>
      Math.max(
        0,
        ACTIONS.findIndex((item) => item.id === action),
      ),
    [action],
  );
  const actionThumbOffset = useSharedValue(0);
  // Per-segment stride mirrored into a shared value so the press
  // handler can move the thumb on the UI thread without reading React
  // state inside a worklet.
  const actionStride = useSharedValue(0);
  const selectedBalance = getVaultBalanceForToken(balances, token);
  const withdrawReadable = action !== 'withdraw' || canReadVaultBalance(selectedBalance);
  const submitBlocked = disabled || !withdrawReadable;
  const submitDisabled = submitBlocked || loading;
  const submitAccessibilityDisabled = loading;
  const showDangerFeedback = feedbackTone === 'danger' && submitBlocked && !loading;
  const submitLabel = loading
    ? (loadingLabel ?? getButtonLabel(action, token, true))
    : feedbackLabel;
  const submitTextColor = loading
    ? colors.text.primary
    : showDangerFeedback
      ? colors.brand.whiteStream
      : submitBlocked
        ? colors.text.tertiary
        : colors.text.primary;

  useEffect(() => {
    actionStride.value = actionSegmentWidth + ACTION_SEGMENT_GAP;
  }, [actionStride, actionSegmentWidth]);

  // Reconcile the thumb with the prop for external changes only. Taps
  // already moved the thumb in the press handler, so this is a no-op
  // when the prop catches up.
  useEffect(() => {
    actionThumbOffset.value = withSpring(
      selectedActionIndex * (actionSegmentWidth + ACTION_SEGMENT_GAP),
      ACTION_THUMB_SPRING,
    );
  }, [actionSegmentWidth, actionThumbOffset, selectedActionIndex]);

  // Slide the thumb immediately on tap, on the UI thread, decoupled
  // from the parent's heavier re-render.
  const handleActionSelect = useCallback(
    (id: UmbraVaultAction, index: number) => {
      actionThumbOffset.value = withSpring(index * actionStride.value, ACTION_THUMB_SPRING);
      onActionChange(id);
    },
    [actionStride, actionThumbOffset, onActionChange],
  );

  const actionThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: actionThumbOffset.value }],
  }));

  return (
    <View style={[styles.card, compact && styles.cardCompact, dense && styles.cardDense]}>
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={[styles.title, compact && styles.titleCompact]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
          >
            Move Funds
          </Text>
          <Text
            variant="small"
            color={colors.text.secondary}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1}
          >
            {subtitle ?? getVaultTokenRowLabel(balances, token, { loadState: balanceLoadState })}
          </Text>
        </View>
      </View>

      <View
        style={[styles.actionGrid, dense && styles.actionGridDense, { height: actionTrackHeight }]}
        onLayout={(event) => setActionTrackWidth(event.nativeEvent.layout.width)}
      >
        {actionSegmentWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.actionThumb,
              {
                width: actionSegmentWidth,
                height: actionSegmentHeight,
                borderRadius: actionSegmentHeight / 2,
              },
              actionThumbStyle,
            ]}
          />
        ) : null}
        <View style={styles.actionSegmentRow}>
          {ACTIONS.map((item, index) => {
            const selected = item.id === action;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (!selected) handleActionSelect(item.id, index);
                }}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.actionSegment,
                  {
                    minHeight: actionSegmentHeight,
                    borderRadius: actionSegmentHeight / 2,
                  },
                  pressed && !selected && styles.actionSegmentPressed,
                ]}
              >
                <Text
                  variant="captionBold"
                  color={selected ? colors.text.primary : colors.text.tertiary}
                  style={styles.segmentText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  maxFontSizeMultiplier={1}
                >
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.tokenPicker}>
        {tokens.map((item) => {
          const selected = item.symbol === token;
          return (
            <Pressable
              key={item.symbol}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Select ${item.symbol}`}
              hitSlop={4}
              onPress={() => onTokenChange(item.symbol)}
              style={({ pressed }) => [
                styles.tokenChip,
                dense && styles.tokenChipDense,
                selected && styles.tokenChipSelected,
                pressed && !selected && styles.tokenChipPressed,
              ]}
            >
              <Text
                variant="captionBold"
                color={selected ? colors.text.primary : colors.text.tertiary}
                style={styles.tokenChipText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.76}
                maxFontSizeMultiplier={1}
              >
                {item.symbol}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.formRow}>
        <View style={[styles.inputWrap, dense && styles.inputWrapDense]}>
          <TextInput
            value={amount}
            onChangeText={onAmountChange}
            placeholder="Amount"
            placeholderTextColor={colors.text.placeholder}
            selectionColor={colors.brand.glossAccent}
            keyboardType="decimal-pad"
            style={[styles.input, dense && styles.inputDense]}
            maxFontSizeMultiplier={1.1}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use max ${token} balance`}
            accessibilityState={{ disabled: maxAmount == null }}
            disabled={maxAmount == null}
            hitSlop={8}
            onPress={onMaxPress}
            style={({ pressed }) => [
              styles.maxPill,
              dense && styles.maxPillDense,
              maxAmount == null && styles.maxPillDisabled,
              pressed && maxAmount != null && styles.maxPillPressed,
            ]}
          >
            <Text
              variant="captionBold"
              color={maxAmount == null ? colors.text.tertiary : colors.text.primary}
              style={styles.maxPillText}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              Max
            </Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          accessibilityState={{ disabled: submitAccessibilityDisabled, busy: loading }}
          disabled={loading}
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.submitButton,
            dense && styles.submitButtonDense,
            showDangerFeedback && styles.submitButtonDanger,
            submitBlocked && !showDangerFeedback && styles.submitButtonDisabled,
            pressed && !submitDisabled && styles.submitButtonPressed,
          ]}
        >
          {loading ? (
            <LazyLoadingSpinner size={dense ? 14 : 16} color={colors.text.onAccent} />
          ) : null}
          <Text
            variant="captionBold"
            color={submitTextColor}
            style={styles.submitText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            maxFontSizeMultiplier={1}
          >
            {submitLabel}
          </Text>
        </Pressable>
      </View>

      {disabledMessage != null ? (
        <Text
          variant="small"
          color={colors.semantic.warning}
          style={styles.helperText}
          numberOfLines={2}
        >
          {disabledMessage}
        </Text>
      ) : null}

      {action === 'withdraw' && !withdrawReadable ? (
        <Text
          variant="small"
          color={colors.semantic.warning}
          style={styles.helperText}
          numberOfLines={2}
        >
          Refresh before withdrawing this token.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.cardElevated,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 0 16px rgba(255, 255, 255, 0.03)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.3)',
      '0 8px 20px rgba(0, 0, 0, 0.3)',
    ].join(', '),
  },
  cardCompact: {
    padding: spacing.md,
    gap: spacing.md,
  },
  cardDense: {
    padding: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: fontFamily.displaySemiBold,
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 22,
  },
  actionGrid: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    padding: ACTION_TRACK_PADDING,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    boxShadow: [
      'inset 0 2px 6px rgba(0, 0, 0, 0.5)',
      'inset 0 0 12px rgba(0, 0, 0, 0.25)',
      'inset 0 -1px 1px rgba(255, 255, 255, 0.08)',
    ].join(', '),
  },
  actionGridDense: {
    padding: ACTION_TRACK_PADDING,
  },
  actionThumb: {
    position: 'absolute',
    top: ACTION_TRACK_PADDING,
    left: ACTION_TRACK_PADDING,
    backgroundColor: 'rgba(62, 62, 62, 0.95)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.38)',
      'inset 0 0 10px rgba(255, 255, 255, 0.08)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.35)',
      '0 4px 10px rgba(0, 0, 0, 0.28)',
    ].join(', '),
  },
  actionSegmentRow: {
    flex: 1,
    flexDirection: 'row',
    gap: ACTION_SEGMENT_GAP,
  },
  actionSegment: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    zIndex: 1,
  },
  actionSegmentPressed: {
    backgroundColor: colors.glass.clearFill,
  },
  segmentText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  tokenPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tokenChip: {
    flex: 1,
    minWidth: 64,
    minHeight: 38,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.clearFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.1)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.2)',
    ].join(', '),
  },
  tokenChipDense: {
    minHeight: 34,
    minWidth: 58,
  },
  tokenChipSelected: {
    backgroundColor: colors.glass.strongFill,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.25)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.3)',
      '0 4px 10px rgba(0, 0, 0, 0.25)',
    ].join(', '),
  },
  tokenChipPressed: {
    opacity: 0.72,
  },
  tokenChipText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    color: colors.text.primary,
    fontFamily: fontFamily.medium,
    fontSize: 16,
  },
  inputWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    paddingRight: 6,
    boxShadow: [
      'inset 0 2px 4px rgba(0, 0, 0, 0.4)',
      'inset 0 0 8px rgba(0, 0, 0, 0.15)',
      'inset 0 -1px 1px rgba(255, 255, 255, 0.06)',
    ].join(', '),
  },
  inputWrapDense: {
    minHeight: 42,
  },
  inputDense: {
    minHeight: 42,
    fontSize: 15,
  },
  maxPill: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.2)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
    ].join(', '),
  },
  maxPillDense: {
    minHeight: 26,
    paddingHorizontal: spacing.xs + 2,
  },
  maxPillDisabled: {
    opacity: 0.5,
  },
  maxPillPressed: {
    opacity: 0.72,
  },
  maxPillText: {
    fontFamily: fontFamily.uiSemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  submitButton: {
    flexShrink: 0,
    minWidth: 116,
    maxWidth: 168,
    minHeight: 48,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.25)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
      '0 4px 12px rgba(0, 0, 0, 0.3)',
    ].join(', '),
  },
  submitButtonDense: {
    minWidth: 104,
    maxWidth: 152,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  submitButtonDisabled: {
    backgroundColor: colors.glass.clearFill,
    borderColor: colors.glass.rimSubtle,
    opacity: 0.62,
  },
  // Glossy red — keeps semantic error color with glass treatment.
  submitButtonDanger: {
    backgroundColor: colors.semantic.error,
    borderColor: 'rgba(255, 100, 110, 0.6)',
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.3)',
      'inset 0 0 12px rgba(255, 77, 90, 0.15)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
      '0 4px 14px rgba(255, 77, 90, 0.25)',
    ].join(', '),
  },
  submitButtonPressed: {
    opacity: 0.72,
  },
  submitText: {
    fontFamily: fontFamily.uiSemiBold,
    flexShrink: 1,
  },
  helperText: {
    lineHeight: 18,
  },
});
