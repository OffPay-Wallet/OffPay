/**
 * HomeHeader — wallet identity, connectivity toggle, and notifications.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { NotificationCenterModal } from '@/components/features/home/NotificationCenterModal';
import { useAppToast } from '@/components/ui/AppToast';
import { PuffyBellIcon } from '@/components/ui/icons/PuffyBellIcon';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { PuffyFaucetGiftIcon } from '@/components/ui/icons/PuffyFaucetGiftIcon';
import { PuffyWifiIcon } from '@/components/ui/icons/PuffyWifiIcon';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { getDevnetAirdropErrorMessage, requestDevnetSolAirdrop } from '@/lib/faucet/devnet-airdrop';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import {
  deleteManagedProfileImage,
  resolveStoredProfileImageUri,
} from '@/lib/profile/profile-image';
import { useAppStore } from '@/store/app';
import { useNotificationStore } from '@/store/notificationStore';
import { useWalletStore } from '@/store/walletStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOGGLE_TIMING = { duration: 150, easing: Easing.out(Easing.cubic) };
const WALLET_PROFILE_ICON = require('../../../assets/AppIcons/playstore.png') as number;

const HeaderWalletProfileIcon = memo(function HeaderWalletProfileIcon({
  onProfileImageError,
  profileImageUri,
  size,
}: {
  onProfileImageError: () => void;
  profileImageUri: string | null;
  size: number;
}): React.JSX.Element {
  const source = profileImageUri != null ? { uri: profileImageUri } : WALLET_PROFILE_ICON;

  return (
    <Image
      source={source}
      style={[styles.walletProfileIcon, { width: size, height: size, borderRadius: size / 2 }]}
      contentFit="contain"
      cachePolicy="memory-disk"
      priority="high"
      transition={0}
      onError={profileImageUri != null ? onProfileImageError : undefined}
      accessible={false}
    />
  );
});

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeHeaderProps {
  /** Current offline mode state — controlled externally */
  isOffline?: boolean;
  /** Called when the user toggles offline mode */
  onToggleOffline?: (isOffline: boolean) => void;
  /** Navigate to the Accounts screen using the existing home transition */
  onPressWalletDetails?: () => void;
  /** Masks wallet address in the header when privacy mode is enabled. */
  privacyHidden?: boolean;
  /** Renders stable skeleton placeholders while wallet identity is loading. */
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function HomeHeaderComponent({
  isOffline: controlledOffline,
  onToggleOffline,
  onPressWalletDetails,
  privacyHidden = false,
  loading = false,
}: HomeHeaderProps = {}): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const { network } = useOffpayNetwork();
  // Internal state (uncontrolled) — falls back when no props provided
  const [internalOffline, setInternalOffline] = useState(false);
  const isOffline = controlledOffline ?? internalOffline;
  const accountName = useWalletStore((s) => s.accountName);
  const publicKey = useWalletStore((s) => s.publicKey);
  const username = useAppStore((s) => s.username);
  const profileImageUri = useAppStore((s) => s.profileImageUri);
  const setProfileImageUri = useAppStore((s) => s.setProfileImageUri);
  const unreadNotifications = useNotificationStore((s) => s.unreadCount);
  const markAllNotificationsRead = useNotificationStore((s) => s.markAllRead);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation values
  const toggleProgress = useSharedValue(isOffline ? 1 : 0);
  const ultraCompactHeader = windowWidth < 360 || fontScale > 1.22;
  const compactHeader = windowWidth < 390 || windowHeight < 760 || fontScale > 1.08;
  const denseHeader = windowWidth < 340 || fontScale > 1.18;
  const showWalletAddress = publicKey != null || privacyHidden;
  const avatarSize = denseHeader ? 36 : ultraCompactHeader ? 38 : compactHeader ? 40 : 44;
  const actionButtonSize = denseHeader ? 40 : ultraCompactHeader ? 42 : compactHeader ? 44 : 46;
  const toggleWidth = denseHeader ? 48 : ultraCompactHeader ? 52 : compactHeader ? 58 : 66;
  const toggleHeight = denseHeader ? 30 : ultraCompactHeader ? 32 : compactHeader ? 34 : 36;
  const toggleKnobSize = denseHeader ? 24 : ultraCompactHeader ? 26 : compactHeader ? 28 : 30;
  const togglePadding = 3;
  const toggleTravel = toggleWidth - toggleKnobSize - togglePadding * 2;
  const toggleIconSize = denseHeader ? 14 : 16;
  const actionIconSize = denseHeader || ultraCompactHeader ? 20 : 22;
  const headerTopPadding = denseHeader ? spacing.sm : compactHeader ? spacing.md : spacing.lg;
  const headerBottomGap = denseHeader ? spacing.xs : spacing.sm;
  const headerGap = denseHeader || ultraCompactHeader ? spacing.xs : spacing.sm;
  const walletGap = denseHeader || ultraCompactHeader ? spacing.xs : spacing.sm;
  const screenHorizontalPadding = denseHeader
    ? spacing.md
    : compactHeader
      ? spacing.lg
      : spacing['2xl'];
  const headerFrameWidth = Math.min(430, windowWidth - screenHorizontalPadding * 2);
  const actionGap = denseHeader || ultraCompactHeader ? 2 : spacing.xs;
  const showDevnetFaucet = network === 'devnet';
  const faucetWidth = actionButtonSize;
  const faucetIconSize = denseHeader || ultraCompactHeader ? 18 : 20;
  const actionClusterWidth =
    Math.max(layout.minTouchTarget, toggleWidth) +
    (showDevnetFaucet ? Math.max(layout.minTouchTarget, faucetWidth) + actionGap : 0) +
    Math.max(layout.minTouchTarget, actionButtonSize) +
    actionGap;
  const walletTextTargetWidth = denseHeader
    ? 84
    : ultraCompactHeader
      ? 96
      : compactHeader
        ? 112
        : 136;
  const walletTextWidth = Math.max(
    72,
    Math.min(
      walletTextTargetWidth,
      headerFrameWidth - actionClusterWidth - headerGap - avatarSize - walletGap - spacing.xs,
    ),
  );
  const notificationSheetTopOffset =
    headerTopPadding + layout.minTouchTarget + spacing.xs + headerBottomGap + spacing.xs;
  const walletDisplayName = username != null ? `@${username}` : accountName;

  useEffect(() => {
    toggleProgress.value = withTiming(isOffline ? 1 : 0, TOGGLE_TIMING);
  }, [isOffline, toggleProgress]);

  useEffect(
    () => () => {
      if (markReadTimerRef.current != null) {
        clearTimeout(markReadTimerRef.current);
      }
    },
    [],
  );

  const handleToggle = useCallback((): void => {
    const next = !isOffline;

    if (onToggleOffline != null) {
      onToggleOffline(next);
    } else {
      toggleProgress.value = withTiming(next ? 1 : 0, TOGGLE_TIMING);
      setInternalOffline(next);
    }
  }, [isOffline, onToggleOffline, toggleProgress]);

  const handleRequestDevnetAirdrop = useCallback(async (): Promise<void> => {
    if (faucetBusy) return;

    if (network !== 'devnet') {
      showToast({
        title: 'Devnet only',
        message: 'Switch to Devnet to request test SOL.',
        variant: 'warning',
        persistToNotificationCenter: false,
      });
      return;
    }

    if (publicKey == null) {
      showToast({
        title: 'Wallet unavailable',
        message: 'Unlock or create a wallet before using the faucet.',
        variant: 'warning',
        persistToNotificationCenter: false,
      });
      return;
    }

    setFaucetBusy(true);
    showToast({
      title: 'Airdrop requested',
      message: 'Requesting 0.25 Devnet SOL and test tokens.',
      variant: 'info',
      persistToNotificationCenter: false,
    });

    try {
      const result = await requestDevnetSolAirdrop(publicKey);

      showToast({
        title: 'Devnet SOL added',
        message: `${result.sol} SOL plus test tokens sent to your wallet.`,
        variant: 'success',
        persistToNotificationCenter: false,
      });

      void queryClient.invalidateQueries({
        queryKey: offpayWalletBalanceQueryKey(publicKey, 'devnet'),
      });
      void queryClient.invalidateQueries({
        queryKey: offpayWalletTransactionsBaseQueryKey(publicKey, 'devnet'),
      });
    } catch (error) {
      showToast({
        title: 'Faucet unavailable',
        message: getDevnetAirdropErrorMessage(error),
        variant: 'error',
        persistToNotificationCenter: false,
      });
    } finally {
      setFaucetBusy(false);
    }
  }, [faucetBusy, network, publicKey, queryClient, showToast]);

  const handleProfileImageError = useCallback((): void => {
    if (profileImageUri == null) return;
    deleteManagedProfileImage(profileImageUri);
    setProfileImageUri(resolveStoredProfileImageUri(null));
  }, [profileImageUri, setProfileImageUri]);

  const handleOpenNotifications = useCallback((): void => {
    if (notificationsVisible) return;

    // Defer the store mutation until after the entrance animation has
    // a chance to start. Marking-all-read writes to the notification
    // store and re-renders every consumer (badge, header), which we
    // want off the same frame the modal is mounting.
    if (markReadTimerRef.current != null) {
      clearTimeout(markReadTimerRef.current);
    }
    if (unreadNotifications > 0) {
      markReadTimerRef.current = setTimeout(() => {
        markReadTimerRef.current = null;
        markAllNotificationsRead();
      }, 360);
    }

    setNotificationsVisible(true);
  }, [markAllNotificationsRead, notificationsVisible, unreadNotifications]);

  const handleCloseNotifications = useCallback((): void => {
    setNotificationsVisible(false);
  }, []);

  // Animated knob position
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: toggleProgress.value * toggleTravel }],
  }));

  // Animated track color - soft translucent white when online
  // (connected), muted grey when offline so it separates from the
  // dark background instead of blending into it. The solid-white knob
  // stays distinct against both.
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      toggleProgress.value,
      [0, 1],
      [colors.surface.cardElevated, colors.glass.strongFill],
    ),
  }));

  const onlineIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(toggleProgress.value, [0, 0.5], [1, 0]),
  }));

  const offlineIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(toggleProgress.value, [0.5, 1], [0, 1]),
  }));

  if (loading) {
    return (
      <View
        style={[styles.header, { paddingTop: headerTopPadding, marginBottom: headerBottomGap }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.walletPressable, { marginRight: headerGap }]}>
          <View style={[styles.walletIdentity, { gap: walletGap }]}>
            <SkeletonBlock width={avatarSize} height={avatarSize} radius={radii.full} />
            <View style={[styles.walletTextBlock, { width: walletTextWidth }]}>
              <SkeletonBlock
                width={walletTextWidth}
                height={denseHeader ? 19 : 23}
                radius={radii.full}
              />
              {showWalletAddress ? (
                <SkeletonBlock
                  width={Math.min(walletTextWidth, denseHeader ? 72 : 104)}
                  height={denseHeader ? 12 : 15}
                  radius={radii.full}
                  style={styles.walletSkeletonAddress}
                />
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.actions, { gap: actionGap }]}>
          <View style={styles.toggleContainer}>
            <View
              style={[
                styles.toggleTouch,
                {
                  width: Math.max(layout.minTouchTarget, toggleWidth),
                  height: layout.minTouchTarget,
                },
              ]}
            >
              <SkeletonBlock width={toggleWidth} height={toggleHeight} radius={toggleHeight / 2} />
            </View>
          </View>
          {showDevnetFaucet ? (
            <SkeletonBlock width={faucetWidth} height={actionButtonSize} radius={radii.full} />
          ) : null}
          <SkeletonBlock width={actionButtonSize} height={actionButtonSize} radius={radii.full} />
        </View>
      </View>
    );
  }

  return (
    <>
      <View
        style={[styles.header, { paddingTop: headerTopPadding, marginBottom: headerBottomGap }]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.walletPressable,
            { marginRight: headerGap },
            pressed ? styles.walletPressed : null,
          ]}
          onPress={onPressWalletDetails}
          disabled={onPressWalletDetails == null}
          accessibilityRole="button"
          accessibilityLabel="Open accounts"
        >
          <View style={[styles.walletIdentity, { gap: walletGap }]}>
            <HeaderWalletProfileIcon
              onProfileImageError={handleProfileImageError}
              profileImageUri={profileImageUri}
              size={avatarSize}
            />
            <View style={[styles.walletTextBlock, { width: walletTextWidth }]}>
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                style={[styles.walletName, denseHeader && styles.walletNameDense]}
                numberOfLines={1}
                ellipsizeMode="tail"
                adjustsFontSizeToFit
                minimumFontScale={0.84}
                maxFontSizeMultiplier={1.05}
              >
                {walletDisplayName}
              </Text>
              {showWalletAddress && privacyHidden ? (
                <View style={styles.walletAddressRow}>
                  <Text
                    variant="small"
                    color={colors.text.secondary}
                    style={[styles.walletAddress, denseHeader && styles.walletAddressDense]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1}
                  >
                    ****
                  </Text>
                </View>
              ) : showWalletAddress ? (
                <View style={styles.walletAddressRow}>
                  <CopyableAddress
                    address={publicKey ?? ''}
                    color={colors.text.secondary}
                    iconSize={denseHeader ? 12 : 14}
                    maxFontSizeMultiplier={1.05}
                    textStyle={[styles.walletAddress, denseHeader && styles.walletAddressDense]}
                  />
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>

        <View style={[styles.actions, { gap: actionGap }]}>
          <View style={styles.toggleContainer}>
            <Pressable
              style={[
                styles.toggleTouch,
                {
                  width: Math.max(layout.minTouchTarget, toggleWidth),
                  height: layout.minTouchTarget,
                },
              ]}
              onPress={handleToggle}
              accessibilityRole="switch"
              accessibilityState={{ checked: isOffline }}
              accessibilityLabel={
                isOffline ? 'Switch to online payments' : 'Switch to offline payments'
              }
            >
              <Animated.View
                style={[
                  styles.toggleTrack,
                  {
                    width: toggleWidth,
                    height: toggleHeight,
                    borderRadius: toggleHeight / 2,
                    padding: togglePadding,
                  },
                  trackStyle,
                ]}
              >
                <Animated.View
                  style={[
                    styles.toggleKnob,
                    {
                      width: toggleKnobSize,
                      height: toggleKnobSize,
                      borderRadius: toggleKnobSize / 2,
                    },
                    knobStyle,
                  ]}
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.toggleIconLayer, onlineIconStyle]}
                  >
                    <PuffyWifiIcon size={toggleIconSize} color={colors.brand.deepShadow} />
                  </Animated.View>
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.toggleIconLayer, offlineIconStyle]}
                  >
                    <PuffyWifiIcon off size={toggleIconSize} color={colors.brand.deepShadow} />
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            </Pressable>
          </View>

          {showDevnetFaucet ? (
            <Pressable
              style={({ pressed }) => [
                styles.faucetTouch,
                {
                  width: Math.max(layout.minTouchTarget, faucetWidth),
                  height: Math.max(layout.minTouchTarget, actionButtonSize),
                },
                pressed && !faucetBusy ? styles.actionControlPressed : null,
                faucetBusy || publicKey == null ? styles.faucetDisabled : null,
              ]}
              onPress={handleRequestDevnetAirdrop}
              disabled={faucetBusy || publicKey == null}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Airdrop 1 Devnet SOL"
              accessibilityState={{ busy: faucetBusy, disabled: faucetBusy || publicKey == null }}
            >
              <View
                style={[
                  styles.faucetGlass,
                  {
                    width: faucetWidth,
                    height: actionButtonSize,
                    borderRadius: actionButtonSize / 2,
                  },
                ]}
              >
                <View pointerEvents="none" style={styles.faucetGloss} />
                {faucetBusy ? (
                  <LazyLoadingSpinner size={18} color={colors.text.primary} />
                ) : (
                  <PuffyFaucetGiftIcon size={faucetIconSize} color={colors.text.primary} />
                )}
              </View>
            </Pressable>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.notificationTouch,
              {
                width: Math.max(layout.minTouchTarget, actionButtonSize),
                height: Math.max(layout.minTouchTarget, actionButtonSize),
              },
              pressed ? styles.actionControlPressed : null,
            ]}
            onPress={handleOpenNotifications}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            accessibilityState={{ expanded: notificationsVisible }}
          >
            <View
              style={[
                styles.notificationGlass,
                { width: actionButtonSize, height: actionButtonSize },
              ]}
            >
              <PuffyBellIcon size={actionIconSize} color={colors.text.primary} />
              {unreadNotifications > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text
                    variant="small"
                    color={colors.brand.whiteStream}
                    style={styles.notificationBadgeText}
                  >
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        </View>
      </View>
      {notificationsVisible ? (
        <NotificationCenterModal
          visible={notificationsVisible}
          onClose={handleCloseNotifications}
          sheetTopOffset={notificationSheetTopOffset}
        />
      ) : null}
    </>
  );
}

export const HomeHeader = memo(HomeHeaderComponent);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  walletPressable: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    minWidth: 0,
    borderRadius: radii.full,
    borderCurve: 'continuous',
  },
  walletPressed: {
    opacity: 0.72,
  },
  walletIdentity: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  walletProfileIcon: {
    overflow: 'hidden',
    backgroundColor: colors.brand.glassTint,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
  },
  walletTextBlock: {
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 1,
    overflow: 'hidden',
  },
  walletName: {
    color: colors.text.primary,
    fontFamily: fontFamily.uiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  walletNameDense: {
    fontSize: 16,
    lineHeight: 20,
  },
  walletAddressRow: {
    width: '100%',
    minWidth: 0,
    overflow: 'hidden',
  },
  walletAddress: {
    color: colors.text.secondary,
    fontFamily: fontFamily.monoMedium,
    fontSize: 12,
    lineHeight: 15,
  },
  walletAddressDense: {
    fontSize: 11,
    lineHeight: 14,
  },
  walletSkeletonAddress: {
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
  },

  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Toggle switch */
  toggleTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    borderCurve: 'continuous',
  },
  toggleTrack: {
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  toggleKnob: {
    backgroundColor: colors.brand.whiteStream,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.82)',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.3)',
  },
  toggleIconLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faucetTouch: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faucetGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  faucetGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '46%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  faucetDisabled: {
    opacity: 0.58,
  },
  notificationGlass: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    overflow: 'visible',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  notificationTouch: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionControlPressed: {
    backgroundColor: colors.surface.pressed,
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: radii.full,
    paddingHorizontal: 4,
    backgroundColor: colors.semantic.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.brand.glassTint,
    zIndex: 2,
  },
  notificationBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.uiBold,
  },
});
