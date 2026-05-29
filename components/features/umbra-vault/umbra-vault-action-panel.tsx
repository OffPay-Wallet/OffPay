import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
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
  /**
   * Display label for the balance the action will draw from.
   * Shield → public wallet balance.
   * Withdraw → shielded vault balance.
   */
  sourceBalanceLabel: string | null;
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
const ACTION_TRACK_PADDING = 4;
const ACTION_SEGMENT_GAP = 4;
const ACTION_TRACK_ANIMATION = { duration: 240, easing: Easing.out(Easing.cubic) };

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
  sourceBalanceLabel,
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
  const actionSegmentHeight = dense ? 28 : 30;
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
  const selectedBalance = getVaultBalanceForToken(balances, token);
  const withdrawReadable = action !== 'withdraw' || canReadVaultBalance(selectedBalance);
  const submitBlocked = disabled || !withdrawReadable;
  const submitDisabled = submitBlocked || loading;
  const showDangerFeedback = feedbackTone === 'danger' && submitBlocked && !loading;
  const submitLabel = loading
    ? (loadingLabel ?? getButtonLabel(action, token, true))
    : feedbackLabel;
  const submitTextColor = loading
    ? colors.text.onAccent
    : showDangerFeedback
      ? colors.brand.whiteStream
      : submitBlocked
        ? colors.text.tertiary
        : colors.text.onAccent;

  useEffect(() => {
    actionThumbOffset.value = withTiming(
      selectedActionIndex * (actionSegmentWidth + ACTION_SEGMENT_GAP),
      ACTION_TRACK_ANIMATION,
    );
  }, [actionSegmentWidth, actionThumbOffset, selectedActionIndex]);

  const actionThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: actionThumbOffset.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(320).delay(100)}
      style={[styles.card, compact && styles.cardCompact, dense && styles.cardDense]}
    >
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
          {ACTIONS.map((item) => {
            const selected = item.id === action;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (!selected) onActionChange(item.id);
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
                  color={selected ? colors.text.onAccent : colors.text.secondary}
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
                color={selected ? colors.text.onAccent : colors.text.secondary}
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
            selectionColor={colors.brand.azureCyan}
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
              color={maxAmount == null ? colors.text.tertiary : colors.brand.navyDepth}
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
          accessibilityState={{ disabled: submitDisabled, busy: loading }}
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

      {sourceBalanceLabel != null ? (
        <Text
          variant="small"
          color={colors.text.secondary}
          style={styles.balanceHint}
          numberOfLines={1}
          ellipsizeMode="tail"
          maxFontSizeMultiplier={1}
        >
          {action === 'withdraw'
            ? `Shielded ${sourceBalanceLabel} ${token}`
            : `Available ${sourceBalanceLabel} ${token}`}
        </Text>
      ) : null}

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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.whiteStream,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: `0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.9), inset 0 -12px 24px rgba(91, 200, 232, 0.1)`,
  },
  cardCompact: {
    padding: spacing.md,
    gap: spacing.sm,
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
    backgroundColor: colors.brand.iceBlue,
    padding: ACTION_TRACK_PADDING,
    overflow: 'hidden',
  },
  actionGridDense: {
    padding: ACTION_TRACK_PADDING,
  },
  actionThumb: {
    position: 'absolute',
    top: ACTION_TRACK_PADDING,
    left: ACTION_TRACK_PADDING,
    backgroundColor: colors.brand.azureCyan,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: `0 10px 18px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.76)`,
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
    backgroundColor: colors.glass.strongFill,
  },
  segmentText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  tokenPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  tokenChip: {
    flex: 1,
    minWidth: 64,
    minHeight: 32,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.iceBlue,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenChipDense: {
    minHeight: 30,
    minWidth: 58,
  },
  tokenChipSelected: {
    backgroundColor: colors.brand.azureCyan,
    borderColor: colors.brand.azureCyan,
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
    minHeight: 46,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.iceBlue,
    paddingRight: 4,
  },
  inputWrapDense: {
    minHeight: 42,
  },
  inputDense: {
    minHeight: 42,
    fontSize: 15,
  },
  maxPill: {
    minHeight: 30,
    paddingHorizontal: spacing.sm,
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
    minHeight: 46,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.azureCyan,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  submitButtonDense: {
    minWidth: 104,
    maxWidth: 152,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  submitButtonDisabled: {
    backgroundColor: colors.brand.iceBlue,
    opacity: 0.62,
  },
  // Solid red — same recipe as the Settings → Reset button. Used
  // when the panel needs to surface a hard "you can't proceed yet"
  // state (e.g. vault not set up).
  submitButtonDanger: {
    backgroundColor: colors.semantic.error,
    borderColor: colors.semantic.error,
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
  balanceHint: {
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
});
