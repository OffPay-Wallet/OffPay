/**
 * HomeHeader — wallet identity, connectivity toggle, and notifications.
 */
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';
import { InteractionManager, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { PuffyBellIcon } from '@/components/ui/icons/PuffyBellIcon';
import { PuffyWifiIcon } from '@/components/ui/icons/PuffyWifiIcon';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useAppStore } from '@/store/app';
import { useNotificationStore } from '@/store/notificationStore';
import { useWalletStore } from '@/store/walletStore';

// Lazy-load the notification sheet so its 470-line tree only ships when
// the user taps the bell. We prefetch the chunk on header mount so the
// first tap never waits on a `import()`.
const NOTIFICATION_MODAL_IMPORT = (): Promise<{
  default: typeof import('@/components/features/home/NotificationCenterModal').NotificationCenterModal;
}> =>
  import('@/components/features/home/NotificationCenterModal').then((module) => ({
    default: module.NotificationCenterModal,
  }));
let notificationModalPrefetch: Promise<unknown> | null = null;
function prefetchNotificationModal(): void {
  if (notificationModalPrefetch != null) return;
  notificationModalPrefetch = NOTIFICATION_MODAL_IMPORT();
}
const NotificationCenterModal = lazy(NOTIFICATION_MODAL_IMPORT);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOGGLE_TIMING = { duration: 150, easing: Easing.out(Easing.cubic) };

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
  // Internal state (uncontrolled) — falls back when no props provided
  const [internalOffline, setInternalOffline] = useState(false);
  const isOffline = controlledOffline ?? internalOffline;
  const accountName = useWalletStore((s) => s.accountName);
  const publicKey = useWalletStore((s) => s.publicKey);
  const username = useAppStore((s) => s.username);
  const unreadNotifications = useNotificationStore((s) => s.unreadCount);
  const markAllNotificationsRead = useNotificationStore((s) => s.markAllRead);
  const [notificationsVisible, setNotificationsVisible] = useState(false);

  // Animation values
  const toggleProgress = useSharedValue(isOffline ? 1 : 0);
  const ultraCompactHeader = windowWidth < 360 || fontScale > 1.22;
  const compactHeader = windowWidth < 390 || windowHeight < 760 || fontScale > 1.08;
  const denseHeader = windowWidth < 340 || fontScale > 1.18;
  const showWalletAddress = publicKey != null || privacyHidden;
  const avatarSize = denseHeader ? 36 : ultraCompactHeader ? 38 : compactHeader ? 40 : 44;
  const actionButtonSize = denseHeader ? 36 : ultraCompactHeader ? 38 : compactHeader ? 40 : 44;
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
  const actionClusterWidth =
    Math.max(layout.minTouchTarget, toggleWidth) + actionButtonSize + actionGap + spacing.xs * 2;
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

  // Prefetch the notification sheet bundle once the home screen has
  // settled. This means the very first bell tap never waits on a
  // dynamic `import()` and the entrance animation can play immediately.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      prefetchNotificationModal();
    });
    return () => handle.cancel();
  }, []);

  const handleToggle = useCallback((): void => {
    const next = !isOffline;

    if (onToggleOffline != null) {
      onToggleOffline(next);
    } else {
      toggleProgress.value = withTiming(next ? 1 : 0, TOGGLE_TIMING);
      setInternalOffline(next);
    }
  }, [isOffline, onToggleOffline, toggleProgress]);

  const handlePrefetchNotifications = useCallback((): void => {
    prefetchNotificationModal();
  }, []);

  const handleOpenNotifications = useCallback((): void => {
    setNotificationsVisible(true);
    // Defer the store mutation until after the entrance animation has
    // a chance to start. Marking-all-read writes to the notification
    // store and re-renders every consumer (badge, header), which we
    // want off the same frame the modal is mounting.
    setTimeout(() => {
      markAllNotificationsRead();
    }, 260);
  }, [markAllNotificationsRead]);

  // Animated knob position
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: toggleProgress.value * toggleTravel }],
  }));

  // Animated track color — soft translucent white when online
  // (connected), muted grey when offline so it separates from the cyan
  // background instead of blending into it. The solid-white knob stays
  // distinct against both.
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      toggleProgress.value,
      [0, 1],
      [colors.glass.clearFill, colors.text.tertiary],
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
                  height: Math.max(40, toggleHeight),
                },
              ]}
            >
              <SkeletonBlock width={toggleWidth} height={toggleHeight} radius={toggleHeight / 2} />
            </View>
          </View>
          <SkeletonBlock width={actionButtonSize} height={actionButtonSize} radius={radii.full} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.header, { paddingTop: headerTopPadding, marginBottom: headerBottomGap }]}>
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
          <WalletAvatar size={avatarSize} solidFill />
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
                height: Math.max(40, toggleHeight),
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

        {/* Notification bell */}
        <Pressable
          style={[styles.notificationGlass, { width: actionButtonSize, height: actionButtonSize }]}
          onPress={handleOpenNotifications}
          onPressIn={handlePrefetchNotifications}
          hitSlop={6}
          accessibilityLabel="Notifications"
        >
          <PuffyBellIcon size={actionIconSize} color={colors.text.primary} />
          {unreadNotifications > 0 ? (
            <View style={styles.notificationBadge}>
              <Text
                variant="small"
                color={colors.text.onAccent}
                style={styles.notificationBadgeText}
              >
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <Suspense fallback={null}>
        {notificationsVisible ? (
          <NotificationCenterModal
            visible={notificationsVisible}
            onClose={() => setNotificationsVisible(false)}
            sheetTopOffset={notificationSheetTopOffset}
          />
        ) : null}
      </Suspense>
    </View>
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
    minHeight: layout.minTouchTarget + spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
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
  },
  toggleTrack: {
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
  },
  toggleKnob: {
    backgroundColor: colors.brand.whiteStream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationGlass: {
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.clearFill,
  },
  notificationBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: radii.full,
    paddingHorizontal: 3,
    backgroundColor: colors.semantic.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: {
    lineHeight: 12,
  },
});
