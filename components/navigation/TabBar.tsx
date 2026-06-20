import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname } from 'expo-router';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PuffyChatIcon } from '@/components/ui/icons/PuffyChatIcon';
import { PuffyHistoryIcon } from '@/components/ui/icons/PuffyHistoryIcon';
import { PuffyHomeIcon } from '@/components/ui/icons/PuffyHomeIcon';
import { PuffyRwaIcon } from '@/components/ui/icons/PuffyRwaIcon';
import { PuffySettingsIcon } from '@/components/ui/icons/PuffySettingsIcon';
import { PuffyShoppingIcon } from '@/components/ui/icons/PuffyShoppingIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { useOverlayVisibilityStore } from '@/store/overlayVisibilityStore';
import { useTabHistoryStore, isTabRouteName } from '@/store/tabHistoryStore';

import type { BottomTabBarProps } from 'expo-router/js-tabs';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const BAR_MIN_H = 64;
const BAR_MAX_H = 70;
const BAR_MAX_W = 460;
const BAR_RADIUS = radii.full;
const MIN_BAR_SIDE_GUTTER = spacing.lg;
const COMFORTABLE_BAR_SIDE_GUTTER = spacing['2xl'];
const FAB_SIZE_BASE = 56;
const FAB_SIZE_COMPACT = 50;
const FAB_GAP = spacing.sm;
const QUICK_ACTION_PUCK_SIZE = 52;
const QUICK_ACTION_ROW_GAP = spacing.md;

// ---------------------------------------------------------------------------
// Material recipes
// ---------------------------------------------------------------------------

const BAR_TINT = colors.brand.graphiteDepth;
const BAR_GLOSS_COLORS = [
  'rgba(255, 255, 255, 0.1)',
  'rgba(255, 255, 255, 0.035)',
  'rgba(0, 0, 0, 0.1)',
  'rgba(0, 0, 0, 0.22)',
] as const;
const BAR_GLOSS_LOCATIONS = [0, 0.36, 0.72, 1] as const;
// Active-tab pill - glossy highlight so the selected tab remains
// readable on the dark floating bar.
const PILL_TINT = colors.brand.glossAccent;
// FAB - solid dark action puck. Gloss comes from inset shadow,
// not a detached highlight patch or gradient paint.
const FAB_PRESSED_OVERLAY = 'rgba(255, 255, 255, 0.08)';
const QUICK_ACTION_PUCK_TINT = '#FFFFFF';
const IS_ANDROID = process.env.EXPO_OS === 'android';

// Tab accent colours - active items take the strong monochrome action,
// inactive items stay solid dark ink with muted grey labels.
const TAB_ACTIVE_TINT = colors.brand.actionFill;
const TAB_INACTIVE_TINT = colors.text.secondary;
const TAB_ACTIVE_LABEL = colors.brand.actionFill;
const TAB_INACTIVE_LABEL = colors.text.secondary;

// Hairline borders — subtle ink edge so the glass surfaces read as
// distinct shapes lifted off the page rather than melting into the
// neutral backdrop.
const BAR_BORDER_COLOR = 'rgba(255, 255, 255, 0.16)';
const PILL_BORDER_COLOR = 'rgba(255, 255, 255, 0.24)';
const FAB_BORDER_COLOR = 'rgba(255, 255, 255, 0.16)';
const HAIRLINE = StyleSheet.hairlineWidth;
// Scrim above the screen content while the FAB menu is open. Uses the
// app's soft neutral tint so the underlying UI reads as gently faded
// out instead of dimmed black.
const SCRIM_COLOR = colors.brand.glassTint;
const SCRIM_OPACITY = 0.82;

// Shadows stay off Android's animated tab surfaces. APK builds were
// spending too much work rasterizing shadowed, transformed views on
// physical devices even though emulators looked fine.
const BAR_SHADOW = '0 8px 24px rgba(0, 0, 0, 0.5)';
const PILL_SHADOW = '0 2px 6px rgba(0, 0, 0, 0.1)';
const FAB_PUCK_SHADOW = '0 6px 16px rgba(0, 0, 0, 0.4)';
const QUICK_ACTION_SHADOW = '0 8px 20px rgba(16, 16, 16, 0.16)';

// Animations — fast UI-thread transforms/opacity. FAB expansion is driven
// directly from a shared value in the press handler so it does not wait for a
// React render before opening or closing.
const TAB_VISIBILITY_SPRING: WithSpringConfig = {
  damping: 28,
  stiffness: 420,
  mass: 0.4,
};
const FAB_EXPANSION_SPRING: WithSpringConfig = {
  damping: 18,
  stiffness: 420,
  mass: 0.55,
};
const TAB_PILL_FEEDBACK_SPRING: WithSpringConfig = {
  damping: 22,
  stiffness: 520,
  mass: 0.45,
};
const TAB_PILL_SLIDE_SPRING: WithSpringConfig = {
  damping: 24,
  stiffness: 440,
  mass: 0.42,
};
const TAB_PILL_PRESS_SCALE = 0.96;

// ---------------------------------------------------------------------------
// Tab metadata
// ---------------------------------------------------------------------------

const PRIMARY_ROUTES = ['index', 'history', 'settings'] as const;

const TAB_LABELS: Record<string, string> = {
  index: 'Home',
  history: 'History',
  settings: 'Settings',
  chat: 'Chat',
  rwas: 'RWAs',
  shopping: 'Shopping',
};

// Routes that exist in the (tabs) group but should not be shown in the
// bar. The screens still exist and are reachable through deep links or
// in-app navigation; they just don't take up a slot here.
const HIDDEN_ROUTES = new Set(['swap', 'scanner', 'chat']);

function getRouteNameFromPathname(pathname: string): string | null {
  const pathOnly = pathname.split(/[?#]/)[0] ?? '';
  const normalized = pathOnly.replace(/\/+$/, '');
  if (
    normalized.length === 0 ||
    normalized === '/' ||
    normalized === '/index' ||
    normalized === '/(tabs)' ||
    normalized === '/(tabs)/index'
  ) {
    return 'index';
  }

  const firstRouteSegment = normalized
    .split('/')
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))[0];

  return firstRouteSegment === 'index' ? 'index' : (firstRouteSegment ?? null);
}

interface QuickAction {
  id: string;
  label: string;
  routeName: string;
  Icon: React.ComponentType<{ size?: number; color?: string; focused?: boolean }>;
  tint: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'rwas',
    label: 'RWAs',
    routeName: 'rwas',
    Icon: PuffyRwaIcon,
    tint: colors.brand.deepShadow,
  },
  {
    id: 'shopping',
    label: 'Shop',
    routeName: 'shopping',
    Icon: PuffyShoppingIcon,
    tint: colors.brand.deepShadow,
  },
  {
    id: 'chat',
    label: 'Chat',
    routeName: 'chat',
    Icon: PuffyChatIcon,
    tint: colors.brand.deepShadow,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabBar({ state, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const { effectiveWalletMode } = useWalletModeState();
  const isOffline = effectiveWalletMode === 'offline';
  const pathnameRouteName = useMemo(() => getRouteNameFromPathname(pathname), [pathname]);
  const pathnameRouteIndex = useMemo(
    () =>
      pathnameRouteName == null
        ? -1
        : state.routes.findIndex((route) => route.name === pathnameRouteName),
    [pathnameRouteName, state.routes],
  );
  const committedActiveIndex = pathnameRouteIndex >= 0 ? pathnameRouteIndex : state.index;
  const activeRouteName = state.routes[committedActiveIndex]?.name ?? '';
  const routeHidesTabBar = HIDDEN_ROUTES.has(activeRouteName);
  const isOverlayActive = useOverlayVisibilityStore((s) => s.isOverlayActive);
  // Hide the bar when the active route opts out OR when a full-screen
  // overlay (settings bottom-sheet) is open over the tabs.
  const tabBarHidden = routeHidesTabBar || isOverlayActive;
  const recordTabSwitch = useTabHistoryStore((s) => s.recordTabSwitch);
  const [offlineSwapNoticeVisible, setOfflineSwapNoticeVisible] = useState(false);
  const [fabMenuInteractive, setFabMenuInteractive] = useState(false);
  const lastVisibleTabIndexRef = useRef(state.index);
  const fabExpandedRef = useRef(false);
  const fabTouchHandledRef = useRef(false);
  const fabExpansion = useSharedValue(0);
  const activePillFeedback = useSharedValue(1);

  const primaryRoutes = useMemo(
    () =>
      state.routes
        .map((route, originalIndex) => ({ route, originalIndex }))
        .filter(({ route }) => (PRIMARY_ROUTES as readonly string[]).includes(route.name)),
    [state.routes],
  );

  const visualActiveOriginalIndex = tabBarHidden
    ? lastVisibleTabIndexRef.current
    : committedActiveIndex;
  const visualActivePrimaryIndex = primaryRoutes.findIndex(
    (entry) => entry.originalIndex === visualActiveOriginalIndex,
  );
  // Active route lives in the bar's primary set when this is true.
  // Routes like `chat` / `shopping` / `rwas` (reachable via the FAB stack) are
  // not in the primary set, so the slider pill should fade away and
  // every primary tab should render in its inactive style.
  const hasPrimaryActiveRoute = visualActivePrimaryIndex >= 0;

  const barVisibility = useDerivedValue(
    () => withSpring(tabBarHidden ? 0 : 1, TAB_VISIBILITY_SPRING),
    [tabBarHidden],
  );

  const setFabMenuExpanded = useCallback(
    (expanded: boolean) => {
      fabExpandedRef.current = expanded;
      fabExpansion.value = withSpring(expanded ? 1 : 0, FAB_EXPANSION_SPRING);
      setFabMenuInteractive(expanded);
    },
    [fabExpansion],
  );

  const closeFabMenu = useCallback(() => {
    setFabMenuExpanded(false);
  }, [setFabMenuExpanded]);

  useEffect(() => {
    if (tabBarHidden) return;
    lastVisibleTabIndexRef.current = committedActiveIndex;
  }, [committedActiveIndex, tabBarHidden]);

  useEffect(() => {
    if (tabBarHidden && fabExpandedRef.current) {
      closeFabMenu();
    }
  }, [closeFabMenu, tabBarHidden]);

  useEffect(() => {
    if (!offlineSwapNoticeVisible) return;
    const timeout = setTimeout(() => setOfflineSwapNoticeVisible(false), 1600);
    return () => clearTimeout(timeout);
  }, [offlineSwapNoticeVisible]);

  const barStyle = useAnimatedStyle(() => ({
    opacity: barVisibility.value,
    transform: [{ translateY: (1 - barVisibility.value) * 10 }],
  }));

  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabExpansion.value * 45}deg` }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: fabExpansion.value * SCRIM_OPACITY,
  }));

  const quickActionStackStyle = useAnimatedStyle(() => ({
    opacity: fabExpansion.value,
    transform: [{ translateY: (1 - fabExpansion.value) * 12 }],
  }));

  const compactTabs = windowWidth < 390 || windowHeight < 760 || fontScale > 1.08;
  const denseTabs = windowWidth < 340 || fontScale > 1.18;
  const adaptiveGutter = Math.round(windowWidth * 0.06);
  const sideGutter = denseTabs
    ? spacing.md
    : windowWidth < 360
      ? MIN_BAR_SIDE_GUTTER
      : Math.max(COMFORTABLE_BAR_SIDE_GUTTER, adaptiveGutter);
  const fabSize = denseTabs ? FAB_SIZE_COMPACT : FAB_SIZE_BASE;
  const totalAvailableWidth = windowWidth - sideGutter * 2;
  // Reserve room on the right edge for the floating "+" button so the
  // capsule and the FAB share the bottom row symmetrically.
  const barWidth = Math.min(totalAvailableWidth - fabSize - FAB_GAP, BAR_MAX_W);
  const rowWidth = barWidth + FAB_GAP + fabSize;
  const rowLeft = (windowWidth - rowWidth) / 2;
  const calculatedBarHeight = Math.round(windowWidth * 0.155);
  const barHeight = denseTabs
    ? 60
    : compactTabs
      ? Math.max(62, Math.min(BAR_MAX_H, calculatedBarHeight))
      : Math.max(BAR_MIN_H, Math.min(BAR_MAX_H, calculatedBarHeight));
  const labelFontSize = denseTabs ? 10 : compactTabs ? 11 : 11;
  const labelLineHeight = labelFontSize + 3;
  const iconSize = denseTabs ? 19 : compactTabs ? 20 : 22;
  const fabPlusSize = denseTabs ? 22 : 26;
  const fabPlusThickness = denseTabs ? 2.7 : 3;
  const quickActionIconSize = denseTabs ? 26 : 28;
  const bottomGap = Math.max(spacing.md, insets.bottom + spacing.xs);
  // Vertical room for the labelled action rows above the FAB.
  const stackedActionsHeight =
    QUICK_ACTIONS.length * QUICK_ACTION_PUCK_SIZE +
    Math.max(0, QUICK_ACTIONS.length - 1) * QUICK_ACTION_ROW_GAP +
    QUICK_ACTION_ROW_GAP;
  const containerHeight = barHeight + bottomGap + stackedActionsHeight;
  const routeCount = Math.max(primaryRoutes.length, 1);
  const innerRailWidth = barWidth;
  const tabSlotWidth = innerRailWidth / routeCount;
  // The active pill hugs each tab slot with a small inset so it reads
  // as a wrapping shape around the icon + label rather than a full-
  // width button.
  const pillInsetX = Math.max(6, Math.round(tabSlotWidth * 0.06));
  const pillInsetY = Math.max(4, Math.round(barHeight * 0.08));
  const activePillHeight = barHeight - pillInsetY * 2;
  const activePillWidth = tabSlotWidth - pillInsetX * 2;
  const activePillX =
    visualActivePrimaryIndex >= 0
      ? visualActivePrimaryIndex * tabSlotWidth + pillInsetX
      : pillInsetX;
  const fabCenterX = rowLeft + barWidth + FAB_GAP + fabSize / 2;
  // Right-edge of the action stack so each row can flow rightwards
  // toward the FAB column (label on the left, puck on the right).
  const actionRowRight = windowWidth - (fabCenterX + QUICK_ACTION_PUCK_SIZE / 2);
  const actionStackBottom = bottomGap + barHeight + QUICK_ACTION_ROW_GAP;
  const activePillTranslateX = useSharedValue(activePillX);

  useAnimatedReaction(
    () => activePillX,
    (currentPillX) => {
      activePillTranslateX.value = withSpring(currentPillX, TAB_PILL_SLIDE_SPRING);
    },
    [activePillX],
  );

  const handleTabLongPress = useCallback(
    (route: BottomTabBarProps['state']['routes'][number]): void => {
      navigation.emit({
        type: 'tabLongPress',
        target: route.key,
      });
    },
    [navigation],
  );

  const handlePrimaryTabLongPress = useCallback(
    (route: BottomTabBarProps['state']['routes'][number]) => {
      handleTabLongPress(route);
    },
    [handleTabLongPress],
  );

  const primeFocusedPillFeedback = useCallback(() => {
    activePillFeedback.value = TAB_PILL_PRESS_SCALE;
    activePillFeedback.value = withSpring(1, TAB_PILL_FEEDBACK_SPRING);
  }, [activePillFeedback]);

  const sliderVisibility = useDerivedValue(
    () => withSpring(hasPrimaryActiveRoute ? 1 : 0, TAB_PILL_FEEDBACK_SPRING),
    [hasPrimaryActiveRoute],
  );
  const sliderStyle = useAnimatedStyle(() => ({
    opacity: sliderVisibility.value,
    transform: [
      { translateX: activePillTranslateX.value },
      { scaleX: activePillFeedback.value },
      { scaleY: activePillFeedback.value },
    ],
  }));

  function handleTabPress(
    route: BottomTabBarProps['state']['routes'][number],
    originalIndex: number,
  ): void {
    if (isOffline && route.name === 'swap') {
      setOfflineSwapNoticeVisible(true);
      return;
    }

    const isFocused = committedActiveIndex === originalIndex;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });

    if (event.defaultPrevented) {
      return;
    }

    if (!isFocused) {
      const currentRoute = state.routes[committedActiveIndex];
      if (currentRoute != null && isTabRouteName(currentRoute.name)) {
        recordTabSwitch(committedActiveIndex, currentRoute.name);
      }
      navigation.navigate(route.name, route.params);
    }
  }

  function renderRouteIcon(
    routeName: string,
    tint: string,
    focused: boolean,
  ): React.JSX.Element | null {
    if (routeName === 'index') {
      return <PuffyHomeIcon size={iconSize} color={tint} focused={focused} />;
    }
    if (routeName === 'history') {
      return <PuffyHistoryIcon size={iconSize} color={tint} focused={focused} />;
    }
    if (routeName === 'settings') {
      return <PuffySettingsIcon size={iconSize} color={tint} focused={focused} />;
    }
    return null;
  }

  const handleFabToggle = useCallback(() => {
    setFabMenuExpanded(!fabExpandedRef.current);
  }, [setFabMenuExpanded]);

  const handleFabPressIn = useCallback(() => {
    fabTouchHandledRef.current = true;
    handleFabToggle();
  }, [handleFabToggle]);

  const handleFabPress = useCallback(() => {
    if (fabTouchHandledRef.current) {
      fabTouchHandledRef.current = false;
      return;
    }
    handleFabToggle();
  }, [handleFabToggle]);

  const handleQuickActionPress = useCallback(
    (action: QuickAction) => {
      const targetRoute = state.routes.find((route) => route.name === action.routeName);
      if (targetRoute != null) {
        const event = navigation.emit({
          type: 'tabPress',
          target: targetRoute.key,
          canPreventDefault: true,
        });

        if (event.defaultPrevented) {
          closeFabMenu();
          return;
        }
      }

      closeFabMenu();
      const currentRoute = state.routes[committedActiveIndex];
      if (
        currentRoute != null &&
        currentRoute.name !== action.routeName &&
        isTabRouteName(currentRoute.name)
      ) {
        recordTabSwitch(committedActiveIndex, currentRoute.name);
      }
      navigation.navigate(action.routeName);
    },
    [closeFabMenu, committedActiveIndex, navigation, recordTabSwitch, state.routes],
  );

  return (
    <View
      style={[styles.container, { height: containerHeight }]}
      pointerEvents={tabBarHidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={tabBarHidden}
      importantForAccessibility={tabBarHidden ? 'no-hide-descendants' : 'auto'}
    >
      {/* Frost scrim - sits behind the bar/FAB/quick actions and fades
          everything underneath to the app's neutral tone. Tap-to-dismiss;
          the negative `top` extends
          the press surface above this absolute-positioned container so
          the entire screen can be tapped to close. */}
      <Animated.View
        pointerEvents={fabMenuInteractive ? 'auto' : 'none'}
        style={[
          styles.scrim,
          { top: -windowHeight, height: windowHeight + containerHeight },
          scrimStyle,
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPressIn={closeFabMenu} />
      </Animated.View>

      {/* Floating capsule — primary tabs */}
      <Animated.View
        style={[
          styles.barOuter,
          { bottom: bottomGap, height: barHeight, left: rowLeft, width: barWidth },
          barStyle,
        ]}
      >
        <View pointerEvents="none" style={[styles.barTint, { backgroundColor: BAR_TINT }]} />
        {!IS_ANDROID ? (
          <LinearGradient
            pointerEvents="none"
            colors={BAR_GLOSS_COLORS}
            locations={BAR_GLOSS_LOCATIONS}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}

        <View style={styles.tabRow}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sliderPill,
              {
                top: pillInsetY,
                height: activePillHeight,
                width: activePillWidth,
              },
              sliderStyle,
            ]}
          >
            <View style={[styles.pillTint, { backgroundColor: PILL_TINT }]} />
          </Animated.View>

          {primaryRoutes.map(({ route, originalIndex }, primaryIndex) => {
            const focused = committedActiveIndex === originalIndex;
            const visuallyFocused =
              hasPrimaryActiveRoute && visualActiveOriginalIndex === originalIndex;
            const tint = visuallyFocused ? TAB_ACTIVE_TINT : TAB_INACTIVE_TINT;
            const labelColor = visuallyFocused ? TAB_ACTIVE_LABEL : TAB_INACTIVE_LABEL;
            const label = TAB_LABELS[route.name] ?? route.name;

            return (
              <Pressable
                key={route.key}
                style={({ pressed }) => [
                  styles.tabItem,
                  {
                    height: barHeight,
                    left: primaryIndex * tabSlotWidth,
                    top: 0,
                    width: tabSlotWidth,
                  },
                  pressed && !visuallyFocused && styles.tabItemPressed,
                ]}
                onPressIn={() => {
                  if (focused) {
                    primeFocusedPillFeedback();
                  }
                }}
                onPress={() => handleTabPress(route, originalIndex)}
                onLongPress={() => handlePrimaryTabLongPress(route)}
                unstable_pressDelay={0}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: focused }}
              >
                <View style={styles.tabContent}>
                  {/* Always render the focused (filled) variant so the
                      icons read as flat solid silhouettes; the colour
                      and label weight differentiate the active state. */}
                  {renderRouteIcon(route.name, tint, true)}
                  <Text
                    color={labelColor}
                    style={[
                      styles.tabLabel,
                      {
                        fontSize: labelFontSize,
                        lineHeight: labelLineHeight,
                        fontFamily: visuallyFocused ? fontFamily.uiSemiBold : fontFamily.uiMedium,
                      },
                    ]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1}
                  >
                    {label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>

      {/* Quick-action stack — labelled rows ("RWAs", "Shopping", "Chat") that
          fade in/out together with the FAB toggle. */}
      <Animated.View
        pointerEvents={fabMenuInteractive ? 'auto' : 'none'}
        style={[
          styles.quickActionStack,
          { bottom: actionStackBottom, right: actionRowRight },
          quickActionStackStyle,
        ]}
      >
        {QUICK_ACTIONS.map((action) => (
          <QuickActionRow
            key={action.id}
            action={action}
            puckSize={QUICK_ACTION_PUCK_SIZE}
            iconSize={quickActionIconSize}
            onPress={handleQuickActionPress}
          />
        ))}
      </Animated.View>

      {/* Floating "+" button */}
      <Animated.View
        style={[
          styles.fabFrame,
          {
            bottom: bottomGap + (barHeight - fabSize) / 2,
            left: fabCenterX - fabSize / 2,
            height: fabSize,
            width: fabSize,
            borderRadius: fabSize / 2,
          },
          barStyle,
        ]}
      >
        <View
          style={[
            styles.fabPuck,
            {
              borderRadius: fabSize / 2,
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.fabPress, pressed && styles.fabPressed]}
            onPressIn={handleFabPressIn}
            onPress={handleFabPress}
            unstable_pressDelay={0}
            accessibilityRole="button"
            accessibilityLabel={fabMenuInteractive ? 'Close quick actions' : 'Open quick actions'}
            accessibilityState={{ expanded: fabMenuInteractive }}
            hitSlop={6}
          >
            <Animated.View style={fabIconStyle}>
              <View style={[styles.fabPlus, { width: fabPlusSize, height: fabPlusSize }]}>
                <View
                  style={[
                    styles.fabPlusBar,
                    {
                      width: fabPlusSize,
                      height: fabPlusThickness,
                      borderRadius: fabPlusThickness / 2,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.fabPlusBar,
                    {
                      width: fabPlusThickness,
                      height: fabPlusSize,
                      borderRadius: fabPlusThickness / 2,
                    },
                  ]}
                />
              </View>
            </Animated.View>
          </Pressable>
        </View>
      </Animated.View>

      {offlineSwapNoticeVisible ? (
        <View
          pointerEvents="none"
          style={[styles.feedbackToast, { bottom: bottomGap + barHeight + spacing.sm }]}
        >
          <Text variant="small" color={colors.brand.whiteStream} style={styles.feedbackToastText}>
            Swap is unavailable offline
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Quick-action labelled row
// ---------------------------------------------------------------------------

interface QuickActionRowProps {
  action: QuickAction;
  puckSize: number;
  iconSize: number;
  onPress: (action: QuickAction) => void;
}

function QuickActionRow({
  action,
  puckSize,
  iconSize,
  onPress,
}: QuickActionRowProps): React.JSX.Element {
  const { Icon } = action;

  return (
    <Pressable
      onPress={() => onPress(action)}
      unstable_pressDelay={0}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      hitSlop={6}
      style={({ pressed }) => [styles.quickActionRow, pressed && styles.quickActionRowPressed]}
    >
      <Text
        variant="bodyBold"
        color={colors.text.primary}
        style={styles.quickActionLabel}
        numberOfLines={1}
        maxFontSizeMultiplier={1}
      >
        {action.label}
      </Text>
      <View
        style={[
          styles.quickActionPuck,
          {
            width: puckSize,
            height: puckSize,
            borderRadius: puckSize / 2,
          },
        ]}
      >
        <Icon size={iconSize} color={action.tint} focused />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: SCRIM_COLOR,
  },
  barOuter: {
    position: 'absolute',
    borderRadius: BAR_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: BAR_TINT,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: HAIRLINE,
    borderRightWidth: HAIRLINE,
    borderColor: BAR_BORDER_COLOR,
    ...(IS_ANDROID ? {} : { boxShadow: BAR_SHADOW }),
  },
  barTint: {
    ...StyleSheet.absoluteFill,
  },
  tabRow: {
    ...StyleSheet.absoluteFill,
  },
  tabItem: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemPressed: {
    opacity: 0.65,
  },
  tabContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    textAlign: 'center',
  },
  feedbackToast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.brand.deepShadow,
    boxShadow: '0 8px 18px rgba(16, 16, 16, 0.32)',
  },
  feedbackToastText: {
    fontSize: 11,
    lineHeight: 14,
  },
  sliderPill: {
    position: 'absolute',
    left: 0,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: HAIRLINE,
    borderRightWidth: HAIRLINE,
    borderColor: PILL_BORDER_COLOR,
  },
  pillTint: {
    ...StyleSheet.absoluteFill,
    ...(IS_ANDROID ? {} : { boxShadow: PILL_SHADOW }),
  },
  fabFrame: {
    position: 'absolute',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPuck: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderBottomWidth: HAIRLINE,
    borderRightWidth: HAIRLINE,
    borderColor: FAB_BORDER_COLOR,
    backgroundColor: colors.brand.actionFill,
    ...(IS_ANDROID ? {} : { boxShadow: FAB_PUCK_SHADOW }),
  },
  fabPress: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPlus: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPlusBar: {
    position: 'absolute',
    backgroundColor: colors.brand.whiteStream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    ...(IS_ANDROID ? {} : { boxShadow: '0 0 6px rgba(255, 255, 255, 0.4)' }),
  },
  fabPressed: {
    backgroundColor: FAB_PRESSED_OVERLAY,
  },
  quickActionStack: {
    position: 'absolute',
    alignItems: 'flex-end',
    gap: QUICK_ACTION_ROW_GAP,
  },
  quickActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  quickActionRowPressed: {
    opacity: 0.7,
  },
  quickActionLabel: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  quickActionPuck: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QUICK_ACTION_PUCK_TINT,
    borderWidth: HAIRLINE,
    borderColor: 'rgba(16, 16, 16, 0.12)',
    ...(IS_ANDROID ? {} : { boxShadow: QUICK_ACTION_SHADOW }),
  },
});
