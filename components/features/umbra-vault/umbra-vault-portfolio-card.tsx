import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PuffyRefreshIcon } from '@/components/ui/icons/PuffyRefreshIcon';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import {
  getShieldedStablecoinValueLabel,
  getVaultTokenRowLabel,
  type UmbraVaultBalanceLoadState,
} from './umbra-vault-format';

import type { UmbraVaultBalance, UmbraVaultTokenConfig } from './types';

interface TokenLogoLookup {
  byMint: ReadonlyMap<string, string>;
  bySymbol: ReadonlyMap<string, string>;
}

interface UmbraVaultPortfolioCardProps {
  balances: UmbraVaultBalance[];
  tokens: UmbraVaultTokenConfig[];
  balanceLoadState: UmbraVaultBalanceLoadState;
  balanceStatusMessage: string | null;
  vaultRegistered: boolean;
  loading: boolean;
  setupLoading: boolean;
  setupDisabled: boolean;
  setupLabel?: string;
  repairLoading: boolean;
  repairAvailable: boolean;
  disabled: boolean;
  disabledMessage: string | null;
  networkLabel: string | null;
  tokenLogos?: TokenLogoLookup;
  onSetup: () => void;
  onRepair: () => void;
  onRefresh: () => void;
}

function resolveUmbraTokenLogo(
  token: UmbraVaultTokenConfig,
  lookup: TokenLogoLookup | undefined,
): string | null {
  const fromMint = lookup?.byMint.get(token.mint);
  if (fromMint != null && fromMint.length > 0) return fromMint;
  const fromSymbol = lookup?.bySymbol.get(token.symbol.toUpperCase());
  if (fromSymbol != null && fromSymbol.length > 0) return fromSymbol;
  for (const alias of token.aliases ?? []) {
    const fromAlias = lookup?.bySymbol.get(alias.toUpperCase());
    if (fromAlias != null && fromAlias.length > 0) return fromAlias;
  }
  return token.logoUri ?? null;
}

function VaultRefreshButton({
  loading,
  disabled,
  compact,
  label,
  onPress,
}: {
  loading: boolean;
  disabled: boolean;
  compact: boolean;
  label?: string;
  onPress: () => void;
}): React.JSX.Element {
  const iconSize = compact ? 15 : 16;
  const buttonDisabled = disabled || loading;
  const buttonLabel = loading ? 'Checking' : (label ?? 'Refresh');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh shielded balance"
      accessibilityState={{ busy: loading, disabled: buttonDisabled }}
      disabled={buttonDisabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallAction,
        compact && styles.smallActionCompact,
        disabled && styles.disabled,
        pressed && !buttonDisabled && styles.pressed,
      ]}
    >
      <View style={[styles.refreshIconSlot, { width: iconSize, height: iconSize }]}>
        {loading ? (
          <Animated.View
            key="refresh-loader"
            entering={FadeIn.duration(100)}
            exiting={FadeOut.duration(80)}
          >
            <LazyLoadingSpinner size={iconSize} color={colors.text.primary} />
          </Animated.View>
        ) : (
          <Animated.View
            key="refresh-icon"
            entering={FadeIn.duration(100)}
            exiting={FadeOut.duration(80)}
          >
            <PuffyRefreshIcon size={iconSize} color={colors.text.primary} />
          </Animated.View>
        )}
      </View>
      <Text
        variant="captionBold"
        color={colors.text.primary}
        style={styles.actionText}
        numberOfLines={1}
        maxFontSizeMultiplier={1}
      >
        {buttonLabel}
      </Text>
    </Pressable>
  );
}

export function UmbraVaultPortfolioCard({
  balances,
  tokens,
  balanceLoadState,
  balanceStatusMessage,
  vaultRegistered,
  loading,
  setupLoading,
  setupDisabled,
  setupLabel,
  repairLoading,
  repairAvailable,
  disabled,
  disabledMessage,
  networkLabel,
  tokenLogos,
  onSetup,
  onRepair,
  onRefresh,
}: UmbraVaultPortfolioCardProps): React.JSX.Element {
  const { width, height, fontScale } = useWindowDimensions();
  const dense = width < 350 || fontScale > 1.18;
  const compact = width < 390 || height < 760 || fontScale > 1.05;
  const actionLoading = setupLoading || loading || repairLoading;
  const setupButtonDisabled = disabled || setupDisabled || setupLoading;
  const setupButtonLabel = setupLabel ?? (setupLoading ? 'Setting up' : 'Set Up');

  return (
    <View style={styles.section}>
      <View style={[styles.card, compact && styles.cardCompact, dense && styles.cardDense]}>
        <View style={styles.topRow}>
          <View style={styles.titleGroup}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={[styles.title, compact && styles.titleCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              maxFontSizeMultiplier={1.1}
            >
              Shielded Portfolio
            </Text>
          </View>
          {vaultRegistered ? (
            <VaultRefreshButton
              compact={compact}
              label={repairAvailable ? 'Repair' : 'Refresh'}
              loading={repairAvailable ? repairLoading : loading}
              disabled={disabled || actionLoading}
              onPress={repairAvailable ? onRepair : onRefresh}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Set up shielded vault"
              accessibilityState={{ busy: setupLoading, disabled: setupButtonDisabled }}
              disabled={setupButtonDisabled}
              hitSlop={6}
              onPress={onSetup}
              style={({ pressed }) => [
                styles.smallAction,
                compact && styles.smallActionCompact,
                styles.setupAction,
                setupButtonDisabled && styles.disabled,
                pressed && !setupButtonDisabled && styles.pressed,
              ]}
            >
              {setupLoading ? (
                <LazyLoadingSpinner size={compact ? 15 : 16} color={colors.text.primary} />
              ) : null}
              <Text
                variant="captionBold"
                color={colors.text.primary}
                style={styles.actionText}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
              >
                {setupButtonLabel}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.valueBlock}>
          <Text
            variant="h1"
            color={colors.text.primary}
            style={[styles.value, compact && styles.valueCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            maxFontSizeMultiplier={1}
          >
            {getShieldedStablecoinValueLabel(
              balances,
              tokens.map((token) => token.symbol),
              { loadState: balanceLoadState },
            )}
          </Text>
          {networkLabel != null ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {networkLabel}
            </Text>
          ) : null}
        </View>

        <View style={styles.tokenGrid}>
          {tokens.map((token) => (
            <View key={token.symbol} style={[styles.tokenRow, dense && styles.tokenRowDense]}>
              <TokenIcon
                symbol={token.symbol}
                name={token.name}
                logoUri={resolveUmbraTokenLogo(token, tokenLogos)}
                size={dense ? 26 : compact ? 28 : layout.avatarSm}
              />
              <View style={styles.tokenText}>
                <Text
                  variant="bodyBold"
                  color={colors.text.primary}
                  style={styles.tokenSymbol}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1}
                >
                  {token.symbol}
                </Text>
                <Text
                  variant="caption"
                  color={colors.text.secondary}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={1}
                >
                  {getVaultTokenRowLabel(balances, token.symbol, {
                    loadState: balanceLoadState,
                  })}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {balanceStatusMessage != null ? (
          <Text
            variant="small"
            color={balanceLoadState === 'error' ? colors.semantic.warning : colors.text.secondary}
            style={styles.disabledText}
            numberOfLines={2}
          >
            {balanceStatusMessage}
          </Text>
        ) : null}

        {disabledMessage != null ? (
          <Text
            variant="small"
            color={colors.semantic.warning}
            style={styles.disabledText}
            numberOfLines={2}
          >
            {disabledMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  section: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 0 16px rgba(255, 255, 255, 0.03)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.3)',
      '0 8px 20px rgba(0, 0, 0, 0.3)',
    ].join(', '),
  },
  card: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: 'transparent',
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardCompact: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardDense: {
    padding: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.displaySemiBold,
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 22,
  },
  smallAction: {
    minHeight: 34,
    borderRadius: radii.full,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 4px 10px rgba(0, 0, 0, 0.25)',
    ].join(', '),
  },
  smallActionCompact: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  setupAction: {
    backgroundColor: colors.glass.strongFill,
  },
  refreshIconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.72,
  },
  valueBlock: {
    gap: 2,
  },
  value: {
    fontFamily: fontFamily.bold,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: 0,
  },
  valueCompact: {
    fontSize: 32,
    lineHeight: 36,
  },
  tokenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tokenRow: {
    minHeight: 52,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.clearFill,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 128,
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
  tokenRowDense: {
    minHeight: 46,
    paddingVertical: spacing.xs,
  },
  tokenText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  tokenSymbol: {
    fontFamily: fontFamily.uiSemiBold,
  },
  disabledText: {
    lineHeight: 18,
  },
});
