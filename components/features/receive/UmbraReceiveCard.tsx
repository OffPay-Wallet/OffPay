import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { UmbraPendingClaimUtxo } from '@/lib/umbra/umbra-execution';

/**
 * UI surface for the Umbra private-receive flow.
 *
 * Each card carries the action button inside its own glass surface
 * (eyebrow → description / status → full-width pill button), matching
 * the inline-CTA pattern used by the swap reference card. The receive
 * screen owns all SDK calls and state; this file is pure presentation.
 */

const CLAIM_PREVIEW_DEFAULT_LIMIT = 2;
const EMPTY_PENDING_CLAIMS: readonly UmbraPendingClaimUtxo[] = [];

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
    pendingClaims?: readonly UmbraPendingClaimUtxo[];
    previewLimit?: number;
    status?: string | null;
    statusTone?: StatusTone;
    buttonLabel: string;
    loadingLabel?: string;
    disabled: boolean;
    loading: boolean;
    allowEmptyAction?: boolean;
    onPress: () => void;
    onViewAllPress?: () => void;
    accessibilityLabel: string;
  };
  /**
   * Replays the staggered entrance of the inner cards whenever this
   * value changes (e.g. when the receive screen switches to the
   * private tab). Omit for a one-shot reveal on mount.
   */
  revealKey?: string | number | boolean;
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
  title,
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
      <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.bodyCard]}>
        <Text
          variant="bodyBold"
          color={colors.text.primary}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={1.1}
          style={styles.cardHeading}
        >
          {title}
        </Text>
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
                  color={colors.text.onAccent}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1.1}
                  style={styles.setupActiveText}
                >
                  Active
                </Text>
                <View style={styles.setupActiveIconWrap}>
                  <Ionicons name="checkmark" size={14} color={colors.text.primary} />
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
                  disabled && !loading && styles.ctaButtonDisabled,
                  pressed && !(disabled || loading) ? styles.pressed : null,
                ]}
              >
                {loading ? (
                  <View style={styles.ctaButtonContent}>
                    <LazyLoadingSpinner size={18} color={colors.text.inverse} />
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
      </View>
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
  allowEmptyAction?: boolean;
  accessibilityLabel: string;
  pendingCount: number;
  pendingClaims?: readonly UmbraPendingClaimUtxo[];
  previewLimit?: number;
}

function formatClaimPreviewTimestamp(ms: number | null): string {
  if (ms == null) return 'Unknown';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const delta = Date.now() - ms;
  if (delta >= 0 && delta < 60_000) return 'Now';
  if (delta >= 60_000 && delta < 60 * 60_000) {
    return `${Math.max(1, Math.round(delta / 60_000))}m`;
  }
  if (delta >= 60 * 60_000 && delta < 24 * 60 * 60_000) {
    return `${Math.max(1, Math.round(delta / (60 * 60_000)))}h`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortenClaimAddress(address: string | null, head = 4, tail = 4): string {
  if (address == null || address.length === 0) return 'Unknown sender';
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

const ClaimPreviewRow = memo(function ClaimPreviewRow({
  utxo,
}: {
  utxo: UmbraPendingClaimUtxo;
}): React.JSX.Element {
  return (
    <View style={styles.claimPreviewRow}>
      <View style={styles.claimPreviewIcon}>
        <Ionicons name="lock-closed" size={13} color={colors.text.primary} />
      </View>
      <View style={styles.claimPreviewTextBlock}>
        <Text
          variant="captionBold"
          color={colors.text.primary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          style={styles.claimPreviewTitle}
        >
          {utxo.kind === 'receiver' ? 'Receiver claim' : 'Self claim'}
        </Text>
        <Text
          variant="caption"
          color={colors.text.secondary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          style={styles.claimPreviewSubtitle}
        >
          {shortenClaimAddress(utxo.senderBase58)} · #{utxo.insertionIndex}
        </Text>
      </View>
      <View style={styles.claimPreviewMetaChip}>
        <Text
          variant="caption"
          color={colors.text.tertiary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          style={styles.claimPreviewMetaText}
        >
          {formatClaimPreviewTimestamp(utxo.depositTimestampMs)}
        </Text>
      </View>
    </View>
  );
});

const ClaimSection = memo(function ClaimSection({
  status,
  statusTone,
  buttonLabel,
  loadingLabel,
  onPress,
  onViewAllPress,
  disabled,
  loading,
  allowEmptyAction = false,
  accessibilityLabel,
  pendingCount,
  pendingClaims,
  previewLimit = CLAIM_PREVIEW_DEFAULT_LIMIT,
}: ClaimSectionProps): React.JSX.Element {
  const statusColor = statusToneColor(statusTone);
  const hasPending = pendingCount > 0;
  const claimDisabled = (!hasPending && !allowEmptyAction) || disabled;
  const safePendingClaims = pendingClaims ?? EMPTY_PENDING_CLAIMS;
  const visibleClaims = useMemo(
    () => safePendingClaims.slice(0, Math.max(0, previewLimit)),
    [safePendingClaims, previewLimit],
  );
  const hiddenClaimCount = Math.max(0, pendingCount - visibleClaims.length);

  return (
    <Animated.View layout={LinearTransition.duration(200)}>
      <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.bodyCard]}>
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
              style={({ pressed }) => [styles.claimViewAllPressable, pressed && styles.pressed]}
            >
              <Text
                variant="captionBold"
                color={colors.text.primary}
                numberOfLines={1}
                maxFontSizeMultiplier={1.1}
                style={styles.claimViewAllText}
              >
                View all
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.text.primary} />
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

        {hasPending && visibleClaims.length > 0 ? (
          <View style={styles.claimPreviewList}>
            {visibleClaims.map((utxo) => (
              <ClaimPreviewRow key={utxo.id} utxo={utxo} />
            ))}
            {hiddenClaimCount > 0 ? (
              <Text
                variant="caption"
                color={colors.text.tertiary}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
                align="center"
                style={styles.claimPreviewMoreText}
              >
                +{hiddenClaimCount} more in all claims
              </Text>
            ) : null}
          </View>
        ) : null}

        {status != null && status.length > 0 ? (
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
            accessibilityState={{ disabled: claimDisabled || loading, busy: loading }}
            style={({ pressed }) => [
              styles.claimActionButton,
              claimDisabled && !loading && styles.ctaButtonDisabled,
              pressed && !(claimDisabled || loading) ? styles.pressed : null,
            ]}
          >
            {loading ? (
              <View style={styles.ctaButtonContent}>
                <LazyLoadingSpinner size={18} color={colors.text.inverse} />
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
      </View>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Card root
// ---------------------------------------------------------------------------

export const UmbraReceiveCard = memo(function UmbraReceiveCard({
  unavailableMessage,
  setupPanel,
  pendingClaimPanel,
  revealKey,
}: UmbraReceiveCardProps): React.JSX.Element {
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(200)}
    >
      <View style={styles.container}>
        {/* Unavailable */}
        {unavailableMessage != null ? (
          <Animated.View entering={FadeIn.duration(180)}>
            <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.bodyCard]}>
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
            </View>
          </Animated.View>
        ) : null}

        {/* Setup */}
        {unavailableMessage == null && setupPanel != null ? (
          <StaggerRevealItem index={0} trigger={revealKey}>
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
          </StaggerRevealItem>
        ) : null}

        {/* Claim */}
        {unavailableMessage == null && pendingClaimPanel != null ? (
          <StaggerRevealItem index={1} trigger={revealKey}>
            <ClaimSection
              status={pendingClaimPanel.status}
              statusTone={pendingClaimPanel.statusTone}
              buttonLabel={pendingClaimPanel.buttonLabel}
              loadingLabel={pendingClaimPanel.loadingLabel}
              onPress={pendingClaimPanel.onPress}
              onViewAllPress={pendingClaimPanel.onViewAllPress}
              disabled={pendingClaimPanel.disabled}
              loading={pendingClaimPanel.loading}
              allowEmptyAction={pendingClaimPanel.allowEmptyAction}
              accessibilityLabel={pendingClaimPanel.accessibilityLabel}
              pendingCount={pendingClaimPanel.pendingCount}
              pendingClaims={pendingClaimPanel.pendingClaims}
              previewLimit={pendingClaimPanel.previewLimit}
            />
          </StaggerRevealItem>
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
  // Card heading — left-aligned title inside the first (setup) card,
  // replacing the old floating "Umbra Claims" badge.
  cardHeading: {
    fontFamily: fontFamily.semiBold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    textAlign: 'left',
  },
  descriptionText: {
    lineHeight: 18,
  },

  // Body card (used by setup / claim / history / unavailable).
  bodyCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    ...CARD_BORDER,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    boxShadow: [
      '0 12px 28px rgba(0, 0, 0, 0.42)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
      'inset 0 0 14px rgba(255, 255, 255, 0.03)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
    ].join(', '),
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
    backgroundColor: colors.brand.glossAccent,
    opacity: 0.6,
    marginVertical: spacing.xs,
  },
  setupStatusChip: {
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.actionFill,
    borderWidth: 1.5,
    borderColor: colors.brand.actionFill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 1,
    maxWidth: '100%',
    boxShadow: [
      '0 6px 14px rgba(16, 16, 16, 0.34)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.38)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.3)',
    ].join(', '),
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
    boxShadow: [
      '0 0 6px rgba(199, 58, 58, 0.35)',
      '0 6px 14px rgba(154, 36, 36, 0.22)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.3)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
    ].join(', '),
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
    backgroundColor: colors.brand.deepShadow,
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
  claimPreviewList: {
    gap: spacing.xs,
  },
  claimPreviewRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.frostFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.1)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.2)',
    ].join(', '),
  },
  claimPreviewIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    flexShrink: 0,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.15)',
      'inset 0 -1px 1px rgba(0, 0, 0, 0.2)',
    ].join(', '),
  },
  claimPreviewTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  claimPreviewTitle: {
    fontFamily: fontFamily.semiBold,
  },
  claimPreviewSubtitle: {
    lineHeight: 15,
  },
  claimPreviewMetaChip: {
    minHeight: 24,
    minWidth: 42,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.badgeFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
  },
  claimPreviewMetaText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  claimPreviewMoreText: {
    fontFamily: fontFamily.uiSemiBold,
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
    backgroundColor: colors.brand.actionFill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    maxWidth: '100%',
    boxShadow: [
      '0 8px 18px rgba(16, 16, 16, 0.32)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.38)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.3)',
    ].join(', '),
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
});
