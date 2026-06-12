/**
 * BalanceCard — unified balance display + quick actions card.
 *
 * Top section: frosted balance panel with wallet address, balance, and label.
 * Bottom section: quick action buttons on the same solid glass surface.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { PuffyReceiveIcon } from '@/components/ui/icons/PuffyReceiveIcon';
import { PuffyRefreshIcon } from '@/components/ui/icons/PuffyRefreshIcon';
import { PuffySendIcon } from '@/components/ui/icons/PuffySendIcon';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { ThreeDPressable, SNAPPY_PRESS_SPRING } from '@/components/ui/ThreeDPressable';
import { FiatMoneyText } from '@/components/ui/FiatMoneyText';
import { SlotText } from '@/components/ui/SlotText';
import { Text } from '@/components/ui/Text';
import { CURRENCIES } from '@/constants/currencies';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuickActionId = 'send' | 'receive' | 'swap';

interface QuickAction {
  id: QuickActionId;
  label: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COPY_FEEDBACK_MS = 1800;
const ADDRESS_TRUNCATE_CHARS = 6;

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'swap', label: 'Swap' },
];
// Single hero container: solid graphite shell with a single ambient shadow
// for separation. Multi-layer inset shadows are visually invisible on most
// Android devices but each layer triggers a separate GPU blur pass during
// animated transitions, causing frame drops on mid-range hardware.
const HEADER_CONTAINER_SHADOW = '0 10px 24px rgba(0, 0, 0, 0.45)';

// Static gradient overlay — all props are constants so this never
// needs to re-render. Memoising prevents the native LinearGradient
// view from being recreated on every BalanceCard render cycle.
const GRADIENT_COLORS = ['rgba(58, 58, 58, 0.95)', 'rgba(34, 34, 34, 0.94)', 'rgba(14, 14, 14, 0.98)'] as const;
const GRADIENT_LOCATIONS = [0, 0.45, 1] as const;
const GRADIENT_START = { x: 0.5, y: 0 } as const;
const GRADIENT_END = { x: 0.5, y: 1 } as const;

const BalanceCardGradient = memo(function BalanceCardGradient(): React.JSX.Element {
  return (
    <LinearGradient
      colors={GRADIENT_COLORS}
      locations={GRADIENT_LOCATIONS}
      start={GRADIENT_START}
      end={GRADIENT_END}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
});

// ---------------------------------------------------------------------------
// Helpers & Components
// ---------------------------------------------------------------------------

function ActionIcon({
  actionId,
  disabled,
  size,
}: {
  actionId: QuickActionId;
  disabled: boolean;
  size: number;
}): React.JSX.Element {
  const iconColor = disabled ? colors.text.tertiary : colors.brand.glossAccent;

  if (actionId === 'send') {
    return <PuffySendIcon size={size} color={iconColor} />;
  }

  if (actionId === 'receive') {
    return <PuffyReceiveIcon size={size} color={iconColor} />;
  }

  return <PuffySwapIcon size={size} color={iconColor} focused />;
}

function ActionButton({
  action,
  disabled,
  compact,
  onPress,
}: {
  action: QuickAction;
  disabled: boolean;
  compact: boolean;
  onPress: (id: string) => void;
}) {
  const handlePress = () => {
    if (disabled) return;
    onPress(action.id);
  };
  const iconSize = compact ? 20 : 22;

  return (
    <ThreeDPressable
      accessibilityLabel={action.label}
      accessibilityState={{ disabled }}
      onPress={handlePress}
      disabled={disabled}
      depth={compact ? 2 : 3}
      borderRadius={radii['2xl']}
      surfaceColor={colors.surface.cardElevated}
      shelfColor={colors.brand.deepShadow}
      borderColor={colors.glass.rim}
      borderWidth={1}
      pressSpring={SNAPPY_PRESS_SPRING}
      capStyle={compact ? styles.actionCapCompact : styles.actionCap}
      capShadow={undefined}
    >
      <View style={[styles.actionIconSlot, { width: iconSize, height: iconSize }]}>
        <ActionIcon actionId={action.id} disabled={disabled} size={iconSize} />
      </View>
      <Text
        variant="small"
        color={disabled ? colors.text.tertiary : colors.text.primary}
        style={styles.actionLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.86}
        maxFontSizeMultiplier={1}
      >
        {action.label}
      </Text>
    </ThreeDPressable>
  );
}

function ActionButtonSkeleton({ compact }: { compact: boolean }): React.JSX.Element {
  const iconSize = compact ? 20 : 22;

  return (
    <View style={[styles.actionItem, compact && styles.actionItemCompact]}>
      <View style={[styles.actionGlass, compact && styles.actionGlassCompact]}>
        <SkeletonBlock width={iconSize} height={iconSize} radius={radii.full} />
        <SkeletonBlock
          width={compact ? 42 : 48}
          height={10}
          radius={radii.full}
          style={styles.actionSkeletonLabel}
        />
      </View>
    </View>
  );
}

function truncateAddress(address: string): string {
  if (address.length <= ADDRESS_TRUNCATE_CHARS * 2 + 3) return address;
  return `${address.slice(0, ADDRESS_TRUNCATE_CHARS)}...${address.slice(-ADDRESS_TRUNCATE_CHARS)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BalanceCardProps {
  /** Wallet public key — displayed truncated with copy button */
  publicKey: string | null;
  networkLabel?: string | null;
  offlineSlotsLabel?: string | null;
  portfolioValueLabel?: string;
  portfolioValueLoading?: boolean;
  selectedCurrency?: string;
  onCurrencyChange?: (currency: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  privacyHidden?: boolean;
  onTogglePrivacy?: () => void;
  /** Balance unit label */
  balanceTicker?: string;
  /** Supporting balance label */
  balanceLabel?: string;
  /** Called when a quick action button is pressed */
  onAction: (actionId: string) => void;
  disabledActionIds?: readonly string[];
  loading?: boolean;
  actionsLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BalanceCard({
  publicKey,
  networkLabel,
  offlineSlotsLabel,
  portfolioValueLabel,
  portfolioValueLoading = false,
  selectedCurrency = 'USD',
  onCurrencyChange,
  onRefresh,
  refreshing = false,
  privacyHidden = false,
  onTogglePrivacy,
  balanceTicker = 'SOL',
  onAction,
  disabledActionIds = [],
  loading = false,
  actionsLoading = false,
}: BalanceCardProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wideLayout = windowWidth >= 520;
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const ultraCompact = windowWidth < 360 || fontScale > 1.18;
  const hasOfflineStatus = offlineSlotsLabel != null;
  const stackFooter = windowWidth < 300 || fontScale > 1.45;
  const [copied, setCopied] = useState(false);
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleActions = useMemo(
    () => QUICK_ACTIONS.filter((action) => !disabledActionIds.includes(action.id)),
    [disabledActionIds],
  );
  const visibleActionKey = useMemo(
    () => visibleActions.map((action) => action.id).join('|'),
    [visibleActions],
  );
  const actionsOpacity = useSharedValue(1);

  useEffect(() => {
    actionsOpacity.value = 0.9;
    actionsOpacity.value = withTiming(1, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
    });
  }, [actionsOpacity, visibleActionKey]);

  const actionsRowStyle = useAnimatedStyle(() => ({
    opacity: actionsOpacity.value,
  }));

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleCopy = useCallback((): void => {
    if (publicKey == null) return;
    void Clipboard.setStringAsync(publicKey);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, [publicKey]);

  const handleAction = useCallback(
    (actionId: string): void => {
      onAction(actionId);
    },
    [onAction],
  );

  const displayAddress = publicKey != null ? truncateAddress(publicKey) : '—';
  const maskedAddress = privacyHidden ? '****' : displayAddress;
  const cardHPadding = compact ? spacing.md : spacing.lg;
  const cardVPadding = compact ? spacing.md : 18;
  const portfolioCardMinHeight = stackFooter ? 202 : compact ? 178 : 200;
  const topControlSize = ultraCompact ? 30 : compact ? 32 : 36;
  const footerControlHeight = ultraCompact ? 30 : 32;
  const statusPillHeight = ultraCompact ? 24 : 26;
  const refreshIconSize = ultraCompact ? 15 : 16;
  const addressPillMaxWidth = ultraCompact ? 136 : compact ? 164 : 198;
  const currencyPillWidth = ultraCompact ? 68 : compact ? 76 : 84;
  const currencySheetTopInset = Math.max(insets.top, spacing.md) + spacing.sm;
  const currencySheetMaxHeight = Math.max(0, windowHeight - currencySheetTopInset);
  const currencySheetPreferredHeight = Math.max(
    windowHeight * (compact ? 0.86 : 0.82),
    Math.min(540, currencySheetMaxHeight),
  );
  const currencySheetHeight = Math.min(currencySheetMaxHeight, currencySheetPreferredHeight);
  const currencySheetBottomPadding = Math.max(insets.bottom, spacing.md) + spacing.md;
  const networkPillWidth = hasOfflineStatus ? (ultraCompact ? 50 : compact ? 58 : 76) : undefined;
  const currencyCode = selectedCurrency ?? 'USD';
  const displayedNetworkLabel =
    ultraCompact && networkLabel != null ? networkLabel.replace(/net$/i, '').trim() : networkLabel;
  const displayedOfflineSlotsLabel =
    ultraCompact && offlineSlotsLabel != null
      ? offlineSlotsLabel.replace(/\s+slots$/i, '').trim()
      : offlineSlotsLabel;
  const slotsPillWidth =
    hasOfflineStatus && displayedOfflineSlotsLabel != null
      ? Math.min(
          ultraCompact ? 90 : compact ? 108 : 124,
          Math.max(
            ultraCompact ? 58 : compact ? 66 : 82,
            displayedOfflineSlotsLabel.length * (ultraCompact ? 5.8 : compact ? 6.2 : 6.6) + 22,
          ),
        )
      : undefined;
  const currencyOptions = useMemo(() => {
    const query = currencySearch.trim().toLowerCase();
    if (query.length === 0) return CURRENCIES;
    return CURRENCIES.filter(
      (currency) =>
        currency.code.toLowerCase().includes(query) ||
        currency.name.toLowerCase().includes(query) ||
        currency.symbol.toLowerCase().includes(query),
    );
  }, [currencySearch]);
  const displayedPortfolioValue = portfolioValueLoading
    ? '--'
    : privacyHidden
      ? '****'
      : (portfolioValueLabel ?? '--');
  const showPortfolioSkeleton = loading || portfolioValueLoading;
  const showActionSkeletons = loading || actionsLoading;
  return (
    <View style={[styles.outer, wideLayout && styles.outerWide]}>
      {/* Single hero container: solid glossy shell, no gradients. */}
      <View style={[styles.heroContainer, compact && styles.heroContainerCompact]}>
        {/* Flat dark balance panel sitting on the gradient. */}
        <View style={[styles.imageWrap, { minHeight: portfolioCardMinHeight }]}>
          {/* Static gradient overlay — memoized to avoid re-compositing
              on every parent render (balance updates, animations). */}
          <BalanceCardGradient />
          <View style={styles.nativeGlossWash} pointerEvents="none" />
          <View
            style={[
              styles.content,
              {
                minHeight: portfolioCardMinHeight,
                paddingHorizontal: cardHPadding,
                paddingVertical: cardVPadding,
              },
            ]}
          >
            <View style={[styles.topRow, ultraCompact && styles.topRowCompact]}>
              {loading ? (
                <>
                  <SkeletonBlock
                    width={compact ? 86 : 104}
                    height={compact ? 18 : 20}
                    radius={radii.full}
                  />
                  <View style={styles.topActions}>
                    <SkeletonBlock
                      width={addressPillMaxWidth}
                      height={topControlSize}
                      radius={radii.full}
                    />
                    <SkeletonBlock
                      width={topControlSize}
                      height={topControlSize}
                      radius={radii.full}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text
                    variant="bodyBold"
                    color={colors.text.primary}
                    style={[styles.ticker, compact && styles.tickerCompact]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    maxFontSizeMultiplier={1.1}
                  >
                    {balanceTicker}
                  </Text>
                  <View style={styles.topActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.addressPill,
                        { height: topControlSize, maxWidth: addressPillMaxWidth },
                        pressed && styles.controlPressed,
                      ]}
                      onPress={handleCopy}
                      disabled={publicKey == null}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Copy wallet address"
                      accessibilityState={{ disabled: publicKey == null }}
                    >
                      <View style={styles.addressPillGlass}>
                        <Text
                          variant="small"
                          color={colors.text.primary}
                          style={styles.addressText}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          adjustsFontSizeToFit
                          minimumFontScale={0.78}
                          maxFontSizeMultiplier={1}
                        >
                          {maskedAddress}
                        </Text>
                        <Ionicons
                          name={copied ? 'checkmark' : 'copy-outline'}
                          size={compact ? 15 : 16}
                          color={colors.text.primary}
                        />
                      </View>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.refreshButton,
                        { width: topControlSize, height: topControlSize },
                        pressed && !refreshing && styles.controlPressed,
                      ]}
                      onPress={onRefresh}
                      disabled={onRefresh == null || refreshing}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Refresh wallet data"
                      accessibilityState={{
                        busy: refreshing,
                        disabled: onRefresh == null || refreshing,
                      }}
                    >
                      <View style={styles.iconControlGlass}>
                        {refreshing ? (
                          <Animated.View
                            key="refresh-loader"
                            entering={FadeIn.duration(100)}
                            exiting={FadeOut.duration(80)}
                            style={styles.refreshLoader}
                          >
                            <LazyLoadingSpinner
                              size={refreshIconSize}
                              color={colors.text.primary}
                            />
                          </Animated.View>
                        ) : (
                          <Animated.View
                            key="refresh-icon"
                            entering={FadeIn.duration(100)}
                            exiting={FadeOut.duration(80)}
                            style={styles.refreshIcon}
                          >
                            <PuffyRefreshIcon
                              size={compact ? 17 : 18}
                              color={colors.text.primary}
                            />
                          </Animated.View>
                        )}
                      </View>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
            <View style={styles.metricRow}>
              <View style={styles.valueCol}>
                {showPortfolioSkeleton ? (
                  <SkeletonBlock
                    width={compact ? 156 : 196}
                    height={compact ? 34 : 42}
                    radius={radii.lg}
                    style={styles.balanceSkeleton}
                  />
                ) : (
                  <SlotText
                    value={displayedPortfolioValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.42}
                    maxFontSizeMultiplier={1}
                  >
                    <FiatMoneyText
                      value={displayedPortfolioValue}
                      size="hero"
                      compact={compact}
                      style={styles.balanceAmount}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.42}
                      maxFontSizeMultiplier={1}
                    />
                  </SlotText>
                )}
              </View>
            </View>
            <View
              style={[
                styles.bottomRow,
                compact && styles.bottomRowCompact,
                stackFooter && styles.bottomRowStacked,
              ]}
            >
              {loading ? (
                <>
                  <View
                    style={[
                      styles.statusPillRow,
                      compact && styles.statusPillRowCompact,
                      stackFooter && styles.statusPillRowStacked,
                    ]}
                  >
                    <SkeletonBlock
                      width={compact ? 82 : 94}
                      height={statusPillHeight}
                      radius={radii.full}
                    />
                    <SkeletonBlock
                      width={compact ? 68 : 82}
                      height={statusPillHeight}
                      radius={radii.full}
                    />
                  </View>
                  <View
                    style={[styles.metricControls, stackFooter && styles.metricControlsStacked]}
                  >
                    <View style={styles.privacyCurrencyRow}>
                      <SkeletonBlock
                        width={footerControlHeight}
                        height={footerControlHeight}
                        radius={radii.full}
                      />
                      <SkeletonBlock
                        width={currencyPillWidth}
                        height={footerControlHeight}
                        radius={radii.full}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  {networkLabel != null || offlineSlotsLabel != null ? (
                    <View
                      style={[
                        styles.statusPillRow,
                        compact && styles.statusPillRowCompact,
                        stackFooter && styles.statusPillRowStacked,
                      ]}
                    >
                      {networkLabel != null ? (
                        <View
                          style={[
                            styles.networkPill,
                            stackFooter && styles.networkPillStacked,
                            {
                              width: networkPillWidth,
                              height: statusPillHeight,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.statusPillGlass,
                              ultraCompact && styles.statusPillGlassCompact,
                            ]}
                          >
                            <Text
                              variant="small"
                              color={colors.text.secondary}
                              style={styles.networkText}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.76}
                              maxFontSizeMultiplier={1}
                            >
                              {displayedNetworkLabel}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                      {offlineSlotsLabel != null ? (
                        <View
                          style={[
                            styles.networkPill,
                            stackFooter && styles.networkPillStacked,
                            {
                              width: slotsPillWidth,
                              height: statusPillHeight,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.statusPillGlass,
                              ultraCompact && styles.statusPillGlassCompact,
                            ]}
                          >
                            <Text
                              variant="small"
                              color={colors.text.secondary}
                              style={styles.networkText}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.76}
                              maxFontSizeMultiplier={1}
                            >
                              {displayedOfflineSlotsLabel}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.networkPillPlaceholder} />
                  )}
                  <View
                    style={[styles.metricControls, stackFooter && styles.metricControlsStacked]}
                  >
                    <View style={styles.privacyCurrencyRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.privacyButton,
                          { width: footerControlHeight, height: footerControlHeight },
                          pressed && styles.controlPressed,
                        ]}
                        onPress={onTogglePrivacy}
                        disabled={onTogglePrivacy == null}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={
                          privacyHidden ? 'Show wallet values' : 'Hide wallet values'
                        }
                        accessibilityState={{
                          checked: privacyHidden,
                          disabled: onTogglePrivacy == null,
                        }}
                      >
                        <View style={styles.iconControlGlass}>
                          <Ionicons
                            name={privacyHidden ? 'eye-off-outline' : 'eye-outline'}
                            size={18}
                            color={colors.text.primary}
                          />
                        </View>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.currencyPill,
                          { width: currencyPillWidth, height: footerControlHeight },
                          pressed && styles.controlPressed,
                        ]}
                        onPress={() => setCurrencyMenuOpen(true)}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Select display currency"
                      >
                        <View style={styles.currencyPillGlass}>
                          <Text
                            variant="small"
                            color={colors.text.primary}
                            style={styles.currencyText}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.82}
                            maxFontSizeMultiplier={1}
                          >
                            {currencyCode}
                          </Text>
                          <Ionicons name="chevron-down" size={13} color={colors.text.secondary} />
                        </View>
                      </Pressable>
                    </View>
                  </View>
                </>
              )}
            </View>
            <Modal
              visible={currencyMenuOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setCurrencyMenuOpen(false)}
            >
              <Pressable style={styles.modalBackdrop} onPress={() => setCurrencyMenuOpen(false)}>
                <Pressable
                  style={[
                    styles.currencySheet,
                    {
                      height: currencySheetHeight,
                      paddingBottom: currencySheetBottomPadding,
                    },
                  ]}
                  onPress={(event) => event.stopPropagation()}
                >
                  <View style={styles.currencySheetHeader}>
                    <Text
                      variant="bodyBold"
                      color={colors.text.primary}
                      style={styles.currencySheetTitle}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.1}
                    >
                      Display Currency
                    </Text>
                    <Pressable
                      style={styles.sheetClose}
                      onPress={() => setCurrencyMenuOpen(false)}
                      accessibilityRole="button"
                      accessibilityLabel="Close currency selector"
                    >
                      <Ionicons name="close" size={18} color={colors.text.primary} />
                    </Pressable>
                  </View>
                  <View style={styles.currencySearchBox}>
                    <Ionicons name="search" size={16} color={colors.text.tertiary} />
                    <TextInput
                      value={currencySearch}
                      onChangeText={setCurrencySearch}
                      placeholder="Search currencies"
                      placeholderTextColor={colors.text.placeholder}
                      selectionColor={colors.brand.glossAccent}
                      autoCorrect={false}
                      autoCapitalize="characters"
                      style={styles.currencySearchInput}
                    />
                  </View>
                  <ScrollView
                    style={styles.currencyScroll}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.currencyList}
                  >
                    {currencyOptions.map((currency) => {
                      const selected = currency.code === currencyCode;
                      return (
                        <Pressable
                          key={currency.code}
                          style={({ pressed }) => [
                            styles.currencyOption,
                            selected && styles.currencyOptionActive,
                            pressed && styles.currencyOptionPressed,
                          ]}
                          onPress={() => {
                            onCurrencyChange?.(currency.code);
                            setCurrencyMenuOpen(false);
                            setCurrencySearch('');
                          }}
                        >
                          <View style={styles.currencyOptionLeft}>
                            <Text
                              variant="body"
                              color={colors.text.primary}
                              style={styles.currencySymbol}
                            >
                              {currency.symbol}
                            </Text>
                            <View style={styles.currencyOptionText}>
                              <Text
                                variant="captionBold"
                                color={colors.text.primary}
                                numberOfLines={1}
                              >
                                {currency.code}
                              </Text>
                              <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
                                {currency.name}
                              </Text>
                            </View>
                          </View>
                          {selected ? (
                            <Ionicons
                              name="checkmark-circle"
                              size={18}
                              color={colors.brand.glossAccent}
                            />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>
          </View>
        </View>

        {/* Actions row — shares the solid hero shell. */}
        <Animated.View
          style={[styles.actionsRow, compact && styles.actionsRowCompact, actionsRowStyle]}
        >
          {visibleActions.map((action) =>
            showActionSkeletons ? (
              <View
                key={`action-skeleton-${action.id}`}
                style={styles.actionSlot}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <ActionButtonSkeleton compact={compact} />
              </View>
            ) : (
              <Animated.View key={action.id} style={styles.actionSlot}>
                <ActionButton
                  action={action}
                  disabled={false}
                  compact={compact}
                  onPress={handleAction}
                />
              </Animated.View>
            ),
          )}
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    alignSelf: 'center',
  },
  outerWide: {
    maxWidth: 430,
  },
  // Single hero container - holds the balance panel + action row.
  heroContainer: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: spacing.md,
    gap: spacing.lg,
    backgroundColor: colors.surface.card,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: HEADER_CONTAINER_SHADOW,
  },
  heroContainerCompact: {
    padding: spacing.sm,
    gap: spacing.md,
  },
  // Frosted balance panel inside the hero container. Translucent fill
  // so the gradient bleeds through (reads as part of the background,
  // not a floating card). Hairline rim, no shadow.
  imageWrap: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.14)',
      'inset 0 0 14px rgba(255, 255, 255, 0.03)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
      '0 6px 16px rgba(0, 0, 0, 0.2)',
    ].join(', '),
  },
  nativeGlossWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.025)',
  },
  content: {
    minWidth: 0,
    justifyContent: 'flex-start',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  topRowCompact: {
    gap: spacing.sm,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minWidth: 0,
  },
  valueCol: {
    width: '72%',
    maxWidth: '72%',
    minWidth: 0,
    alignItems: 'center',
  },
  bottomRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    minWidth: 0,
  },
  bottomRowCompact: {
    gap: spacing.sm,
  },
  bottomRowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  statusPillRow: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  statusPillRowCompact: {
    gap: 3,
  },
  statusPillRowStacked: {
    width: '100%',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  networkPill: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: colors.glass.strongFill,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
  },
  networkPillStacked: {
    flex: 1,
  },
  statusPillGlass: {
    height: '100%',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillGlassCompact: {
    paddingHorizontal: spacing.sm,
  },
  networkPillPlaceholder: {
    width: 1,
    height: 34,
  },
  networkText: {
    fontFamily: fontFamily.uiMedium,
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  metricControls: {
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  metricControlsStacked: {
    width: '100%',
    alignItems: 'flex-end',
  },
  privacyCurrencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    minWidth: 0,
  },
  ticker: {
    flexShrink: 1,
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  tickerCompact: {
    fontSize: 18,
    lineHeight: 24,
  },
  controlPressed: {
    opacity: 0.72,
  },
  addressPill: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    flexShrink: 1,
    minWidth: 0,
    backgroundColor: colors.glass.strongFill,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
  },
  addressPillGlass: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 0,
  },
  addressText: {
    fontFamily: fontFamily.mono,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
  },
  balanceAmount: {
    width: '100%',
  },
  balanceSkeleton: {
    alignSelf: 'center',
  },
  currencyPill: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    flexShrink: 0,
    backgroundColor: colors.glass.strongFill,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
  },
  currencyPillGlass: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  currencyText: {
    fontFamily: fontFamily.uiMedium,
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 1,
  },
  refreshButton: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
  },
  iconControlGlass: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshLoader: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIcon: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyButton: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    flexShrink: 0,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 16, 16, 0.42)',
    justifyContent: 'flex-end',
  },
  currencySheet: {
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    boxShadow: HEADER_CONTAINER_SHADOW,
  },
  currencySheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  currencySheetTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glassTint,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 8px 18px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
  },
  currencySearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.glassTint,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
    paddingHorizontal: spacing.md,
    height: 42,
    marginBottom: spacing.md,
  },
  currencySearchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    paddingVertical: 0,
  },
  currencyScroll: {
    flex: 1,
    minHeight: 0,
  },
  currencyList: {
    gap: spacing.xs,
    paddingBottom: 0,
  },
  currencyOption: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: `0 8px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  currencyOptionActive: {
    backgroundColor: colors.brand.glassTint,
    borderColor: colors.glass.rim,
  },
  currencyOptionPressed: {
    backgroundColor: colors.surface.backgroundTint,
  },
  currencyOptionLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  currencySymbol: {
    width: 34,
    textAlign: 'center',
    fontFamily: fontFamily.semiBold,
  },
  currencyOptionText: {
    flex: 1,
    minWidth: 0,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionsRowCompact: {
    gap: spacing.sm,
  },
  actionSlot: {
    flex: 1,
    minWidth: 0,
  },
  // Cap geometry for the Send/Receive/Swap ThreeDPressable buttons.
  // The shelf + spring come from ThreeDPressable; these just size the
  // cap face and lay out the icon + label.
  actionCap: {
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  actionCapCompact: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  // Flat skeleton shell — mirrors the cap footprint while loading.
  actionItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  actionGlass: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  actionGlassCompact: {
    minHeight: 52,
  },
  actionItemCompact: {
    minHeight: 52,
  },
  actionIconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  actionSkeletonLabel: {
    marginTop: spacing.xs,
  },
});
