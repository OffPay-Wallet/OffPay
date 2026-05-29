import React, { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { UmbraPrivacyReceipt } from '@/store/umbraPrivacyStore';

/**
 * UI surface for the Umbra private-receive flow.
 *
 * Each card carries the action button inside its own glass surface
 * (eyebrow → description / status → full-width pill button), matching
 * the inline-CTA pattern used by the swap reference card. The receive
 * screen owns all SDK calls and state; this file is pure presentation.
 */

const PRIVATE_CARD_COLORS = [
  colors.brand.whiteStream,
  colors.brand.iceBlue,
  colors.brand.whiteStream,
] as const;

type StatusTone = 'neutral' | 'success' | 'warning' | 'error';

interface UmbraReceiveCardProps {
  unavailableMessage?: string | null;
  setupPanel?: {
    title: string;
    buttonLabel: string;
    loadingLabel?: string;
    disabled: boolean;
    loading: boolean;
    onPress: () => void;
    accessibilityLabel: string;
    /**
     * When the setup is already complete the card swaps the action
     * button for an inline "Active" pill with a green check.
     */
    completed?: boolean;
  };
  pendingClaimPanel?: {
    pendingCount: number;
    status?: string | null;
    statusTone?: StatusTone;
    buttonLabel: string;
    loadingLabel?: string;
    disabled: boolean;
    loading: boolean;
    onPress: () => void;
    onViewAllPress?: () => void;
    accessibilityLabel: string;
  };
  /** Recent claim/private receipts to surface inline. */
  history?: readonly UmbraPrivacyReceipt[];
  /** Maximum number of receipts to show inline before the View all CTA. */
  historyLimit?: number;
  /** Tap handler for the "View all" CTA. Hidden when omitted. */
  onViewAllHistory?: () => void;
}

function statusToneColor(tone: StatusTone | undefined): string {
  switch (tone) {
    case 'success':
      return colors.semantic.success;
    case 'warning':
      return colors.semantic.warning;
    case 'error':
      return colors.semantic.error;
    default:
      return colors.text.secondary;
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Setup section — title + STATUS badge + tinted action / Active pill.
// ---------------------------------------------------------------------------

interface SetupSectionProps {
  title: string;
  buttonLabel: string;
  loadingLabel?: string;
  onPress: () => void;
  disabled: boolean;
  loading: boolean;
  accessibilityLabel: string;
  completed: boolean;
}

const SetupSection = memo(function SetupSection({
  title: _title,
  buttonLabel,
  loadingLabel,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
  completed,
}: SetupSectionProps): React.JSX.Element {
  return (
    <Animated.View layout={LinearTransition.duration(200)}>
      <LinearGradient
        colors={[...PRIVATE_CARD_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bodyCard}
      >
        <View style={styles.setupRow}>
          {/* Left column — STATUS box. */}
          <View style={styles.setupCell}>
            <View style={styles.setupStatusChip}>
              <Text
                variant="caption"
                color={colors.text.inverse}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                maxFontSizeMultiplier={1.1}
                style={styles.setupStatusChipText}
              >
                STATUS
              </Text>
            </View>
          </View>

          {/* Vertical divider between the two columns. */}
          <View style={styles.setupDivider} />

          {/* Right column — Active pill or Set up action. */}
          <View style={[styles.setupCell, styles.setupCellEnd]}>
            {completed ? (
            <View style={styles.setupActiveBadge}>
              <Text
                variant="bodyBold"
                color={colors.brand.whiteStream}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.1}
                style={styles.setupActiveText}
              >
                Active
              </Text>
              <View style={styles.setupActiveIconWrap}>
                <Ionicons name="checkmark" size={14} color={colors.semantic.success} />
              </View>
            </View>
          ) : (
              <Pressable
                onPress={onPress}
                disabled={disabled || loading}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled, busy: loading }}
                style={({ pressed }) => [
                  styles.setupActionButton,
                  (disabled || loading) && styles.ctaButtonDisabled,
                  pressed && !(disabled || loading) ? styles.pressed : null,
                ]}
              >
                {loading ? (
                  <View style={styles.ctaButtonContent}>
                    <ActivityIndicator size="small" color={colors.text.inverse} />
                    {loadingLabel != null && loadingLabel.length > 0 ? (
                      <Text
                        variant="button"
                        color={colors.text.inverse}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1.1}
                        style={styles.setupActionText}
                      >
                        {loadingLabel}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text
                    variant="button"
                    color={colors.text.inverse}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    maxFontSizeMultiplier={1.1}
                    style={styles.setupActionText}
                  >
                    {buttonLabel}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Claim section — eyebrow / pending count or em-dash / description / CTA.
// ---------------------------------------------------------------------------

interface ClaimSectionProps {
  status?: string | null;
  statusTone?: StatusTone;
  buttonLabel: string;
  loadingLabel?: string;
  onPress: () => void;
  onViewAllPress?: () => void;
  disabled: boolean;
  loading: boolean;
  accessibilityLabel: string;
  pendingCount: number;
}

const ClaimSection = memo(function ClaimSection({
  status,
  statusTone,
  buttonLabel,
  loadingLabel,
  onPress,
  onViewAllPress,
  disabled,
  loading,
  accessibilityLabel,
  pendingCount,
}: ClaimSectionProps): React.JSX.Element {
  const statusColor = statusToneColor(statusTone);
  const hasPending = pendingCount > 0;
  const claimDisabled = !hasPending || disabled;

  return (
    <Animated.View layout={LinearTransition.duration(200)}>
      <LinearGradient
        colors={[...PRIVATE_CARD_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bodyCard}
      >
        <View style={styles.claimHeaderRow}>
          {/* Left — PENDING chip with count when active. */}
          <View style={styles.setupStatusChip}>
            <Text
              variant="caption"
              color={colors.text.inverse}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              maxFontSizeMultiplier={1.1}
              style={styles.setupStatusChipText}
            >
              {hasPending ? `PENDING · ${pendingCount}` : 'PENDING'}
            </Text>
          </View>

          {/* Right — View all link is always visible so the user can
              inspect history (or the empty-state explainer) regardless
              of whether anything is pending right now. */}
          {onViewAllPress != null ? (
            <Pressable
              onPress={onViewAllPress}
              accessibilityRole="button"
              accessibilityLabel="View all pending Umbra claims"
              hitSlop={8}
              style={({ pressed }) => [
                styles.claimViewAllPressable,
                pressed && styles.pressed,
              ]}
            >
              <Text
                variant="captionBold"
                color={colors.brand.azureBlue}
                numberOfLines={1}
                maxFontSizeMultiplier={1.1}
                style={styles.claimViewAllText}
              >
                View all
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={colors.brand.azureBlue}
              />
            </Pressable>
          ) : null}
        </View>

        {hasPending ? (
          <Text
            variant="small"
            color={colors.text.secondary}
            numberOfLines={2}
            maxFontSizeMultiplier={1}
            align="center"
            style={styles.descriptionText}
          >
            Ready to settle into your encrypted balance.
          </Text>
        ) : (
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
            align="center"
            style={styles.claimEmptyTitle}
          >
            No pending claims
          </Text>
        )}

        {hasPending && status != null && status.length > 0 ? (
          <Text
            variant="small"
            color={statusColor}
            numberOfLines={2}
            maxFontSizeMultiplier={1}
            align="center"
            style={styles.descriptionText}
          >
            {status}
          </Text>
        ) : null}

        <View style={styles.claimButtonWrap}>
          <Pressable
            onPress={onPress}
            disabled={claimDisabled || loading}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled: claimDisabled, busy: loading }}
            style={({ pressed }) => [
              styles.claimActionButton,
              (claimDisabled || loading) && styles.ctaButtonDisabled,
              pressed && !(claimDisabled || loading) ? styles.pressed : null,
            ]}
          >
            {loading ? (
              <View style={styles.ctaButtonContent}>
                <ActivityIndicator size="small" color={colors.text.inverse} />
                {loadingLabel != null && loadingLabel.length > 0 ? (
                  <Text
                    variant="button"
                    color={colors.text.inverse}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    maxFontSizeMultiplier={1.1}
                    style={styles.setupActionText}
                  >
                    {loadingLabel}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text
                variant="button"
                color={colors.text.inverse}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.1}
                style={styles.setupActionText}
              >
                {buttonLabel}
              </Text>
            )}
          </Pressable>
        </View>
      </LinearGradient>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// History card — eyebrow + View all + simple stack of rows.
// ---------------------------------------------------------------------------

interface UmbraHistoryRowProps {
  receipt: UmbraPrivacyReceipt;
}

const UmbraHistoryRow = memo(function UmbraHistoryRow({
  receipt,
}: UmbraHistoryRowProps): React.JSX.Element {
  const subtitle = formatReceiptSubtitle(receipt);
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyTextBlock}>
        <Text
          variant="captionBold"
          color={colors.text.primary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          style={styles.historyTitle}
        >
          {receipt.title}
        </Text>
        <Text
          variant="caption"
          color={colors.text.secondary}
          numberOfLines={2}
          maxFontSizeMultiplier={1}
          style={styles.historySubtitle}
        >
          {subtitle}
        </Text>
      </View>
      <View style={styles.historyTimestampChip}>
        <Text
          variant="caption"
          color={colors.text.tertiary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          style={styles.historyTimestampText}
        >
          {formatReceiptTimestamp(receipt.createdAt)}
        </Text>
      </View>
    </View>
  );
});

function formatReceiptSubtitle(receipt: UmbraPrivacyReceipt): string {
  if (receipt.subtitle.length === 0) return receipt.action;
  return receipt.subtitle;
}

function formatReceiptTimestamp(createdAt: number): string {
  const now = Date.now();
  const delta = now - createdAt;
  if (delta < 60_000) return 'Just now';
  if (delta < 60 * 60_000) {
    const mins = Math.max(1, Math.round(delta / 60_000));
    return `${mins}m ago`;
  }
  if (delta < 24 * 60 * 60_000) {
    const hours = Math.max(1, Math.round(delta / (60 * 60_000)));
    return `${hours}h ago`;
  }
  const days = Math.max(1, Math.round(delta / (24 * 60 * 60_000)));
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Card root
// ---------------------------------------------------------------------------

export const UmbraReceiveCard = memo(function UmbraReceiveCard({
  unavailableMessage,
  setupPanel,
  pendingClaimPanel,
  history,
  historyLimit = 3,
  onViewAllHistory,
}: UmbraReceiveCardProps): React.JSX.Element {
  const trimmedHistory = useMemo(() => {
    if (history == null || history.length === 0) return [];
    return history.slice(0, historyLimit);
  }, [history, historyLimit]);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(200)}
    >
      <View style={styles.container}>
        {/* Header — centered solid-blue badge. */}
        <View style={styles.headerBadgeWrap}>
          <View style={styles.headerBadge}>
            <Text
              variant="bodyBold"
              color={colors.text.inverse}
              numberOfLines={1}
              maxFontSizeMultiplier={1.1}
              style={styles.headerBadgeText}
            >
              Umbra Claims
            </Text>
          </View>
        </View>

        {/* Unavailable */}
        {unavailableMessage != null ? (
          <Animated.View entering={FadeIn.duration(180)}>
            <LinearGradient
              colors={[...PRIVATE_CARD_COLORS]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.bodyCard}
            >
              <Text
                variant="caption"
                color={colors.text.tertiary}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
                style={styles.eyebrow}
              >
                UNAVAILABLE
              </Text>
              <Text
                variant="small"
                color={colors.text.secondary}
                numberOfLines={4}
                maxFontSizeMultiplier={1}
                style={styles.descriptionText}
              >
                {unavailableMessage}
              </Text>
            </LinearGradient>
          </Animated.View>
        ) : null}

        {/* Setup */}
        {unavailableMessage == null && setupPanel != null ? (
          <SetupSection
            title={setupPanel.title}
            buttonLabel={setupPanel.buttonLabel}
            loadingLabel={setupPanel.loadingLabel}
            onPress={setupPanel.onPress}
            disabled={setupPanel.disabled}
            loading={setupPanel.loading}
            accessibilityLabel={setupPanel.accessibilityLabel}
            completed={setupPanel.completed === true}
          />
        ) : null}

        {/* Claim */}
        {unavailableMessage == null && pendingClaimPanel != null ? (
          <ClaimSection
            status={pendingClaimPanel.status}
            statusTone={pendingClaimPanel.statusTone}
            buttonLabel={pendingClaimPanel.buttonLabel}
            loadingLabel={pendingClaimPanel.loadingLabel}
            onPress={pendingClaimPanel.onPress}
            onViewAllPress={pendingClaimPanel.onViewAllPress}
            disabled={pendingClaimPanel.disabled}
            loading={pendingClaimPanel.loading}
            accessibilityLabel={pendingClaimPanel.accessibilityLabel}
            pendingCount={pendingClaimPanel.pendingCount}
          />
        ) : null}

        {/* History */}
        {trimmedHistory.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(220).delay(80)}
            layout={LinearTransition.duration(200)}
          >
            <LinearGradient
              colors={[...PRIVATE_CARD_COLORS]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.bodyCard}
            >
              <View style={styles.historyHeader}>
                <Text
                  variant="caption"
                  color={colors.text.tertiary}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1}
                  style={styles.eyebrow}
                >
                  RECENT ACTIVITY
                </Text>
                {onViewAllHistory != null ? (
                  <Pressable
                    onPress={onViewAllHistory}
                    accessibilityRole="button"
                    accessibilityLabel="View all private receive activity"
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.viewAllPressable,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      variant="captionBold"
                      color={colors.brand.deepShadow}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1}
                      style={styles.viewAllText}
                    >
                      View all
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={colors.brand.deepShadow}
                    />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.historyList}>
                {trimmedHistory.map((receipt) => (
                  <UmbraHistoryRow key={receipt.id} receipt={receipt} />
                ))}
              </View>
            </LinearGradient>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CARD_BORDER = {
  borderTopWidth: 1,
  borderLeftWidth: 1,
  borderRightWidth: StyleSheet.hairlineWidth,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderColor: colors.glass.rim,
} as const;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
  },

  // Shared.
  eyebrow: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0.8,
    fontSize: 11,
    lineHeight: 14,
  },
  descriptionText: {
    lineHeight: 18,
  },

  // Header badge — centered solid-blue pill (no card).
  headerBadgeWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadge: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.azureBlue,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
  },
  headerBadgeText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.1,
    textAlign: 'center',
  },

  // Body card (used by setup / claim / history / unavailable).
  bodyCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    ...CARD_BORDER,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    boxShadow: `0 12px 24px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.72)`,
  },

  // Setup row — equal-width left/right columns. Each cell flexes
  // freely so the chip + value/action never overflow on small screens
  // and never push past the card on big ones.
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  setupCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  setupCellEnd: {
    justifyContent: 'flex-end',
  },
  setupDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.brand.azureCyan,
    opacity: 0.6,
    marginVertical: spacing.xs,
  },
  setupStatusChip: {
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.azureBlue,
    borderWidth: 1.5,
    borderColor: colors.brand.azureBlue,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 1,
    maxWidth: '100%',
    boxShadow: `0 8px 18px rgba(46, 174, 210, 0.34), inset 0 1px 1px rgba(255, 255, 255, 0.45)`,
  },
  setupStatusChipText: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0.8,
    fontSize: 12,
    lineHeight: 14,
  },
  setupActionButton: {
    minHeight: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.semantic.error,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    maxWidth: '100%',
    // Faint red accent — small ambient halo, no bloom.
    boxShadow:
      '0 0 6px rgba(199, 58, 58, 0.35), 0 6px 14px rgba(154, 36, 36, 0.22), inset 0 1px 1px rgba(255, 255, 255, 0.28)',
  },
  setupActionText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  setupActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 38,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.semantic.success,
    flexShrink: 1,
    maxWidth: '100%',
    // Faint green accent — small ambient halo, no bloom.
    boxShadow:
      '0 0 6px rgba(22, 138, 100, 0.35), 0 6px 14px rgba(22, 138, 100, 0.22), inset 0 1px 1px rgba(255, 255, 255, 0.28)',
  },
  setupActiveText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  setupActiveIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brand.whiteStream,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // Claim card — top row (PENDING + View all) and CTA. The card
  // intentionally has no internal divider; the Setup card still uses
  // its 2-column row but the Claim card splits horizontally only at
  // the top and lets the CTA span full width below.
  claimHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  claimViewAllPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
  },
  claimViewAllText: {
    fontFamily: fontFamily.semiBold,
  },
  claimEmptyTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    paddingTop: spacing.xs,
  },
  claimButtonWrap: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  claimActionButton: {
    minHeight: 46,
    minWidth: 200,
    paddingHorizontal: spacing['3xl'],
    borderRadius: radii.full,
    backgroundColor: colors.brand.azureBlue,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    maxWidth: '100%',
    boxShadow: `0 10px 22px rgba(46, 174, 210, 0.32), inset 0 1px 1px rgba(255, 255, 255, 0.42)`,
  },

  // Shared CTA helpers (used by Setup + Claim action buttons).
  ctaButtonDisabled: {
    opacity: 0.4,
  },
  ctaButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
  },

  // History.
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  viewAllPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
  },
  viewAllText: {
    fontFamily: fontFamily.semiBold,
  },
  historyList: {
    gap: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  historyTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  historyTitle: {
    fontFamily: fontFamily.semiBold,
  },
  historySubtitle: {
    lineHeight: 16,
  },
  historyTimestampChip: {
    minHeight: 26,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.badgeFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  historyTimestampText: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0.2,
  },
});
