import { memo, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { getViewportProfile } from '@/lib/ui/responsive-layout';

import type { PrivatePaymentRoute, PrivatePaymentRouteOption } from './types';

interface PrivateRouteSelectorProps {
  routes: PrivatePaymentRouteOption[];
  selectedRoute: PrivatePaymentRoute | null;
  onSelectRoute: (route: PrivatePaymentRoute) => void;
}

const SELECT_TIMING = { duration: 160, easing: Easing.out(Easing.cubic) } as const;

export const PrivateRouteSelector = memo(function PrivateRouteSelector({
  routes,
  selectedRoute,
  onSelectRoute,
}: PrivateRouteSelectorProps): React.JSX.Element | null {
  const { width, height, fontScale } = useWindowDimensions();
  if (routes.length === 0 || selectedRoute == null) return null;

  const viewportProfile = getViewportProfile({ width, height, fontScale });
  const stackRoutes = width < 340 || routes.length === 1;
  const dense = viewportProfile.dense;

  return (
    <View style={styles.section}>
      <View style={[styles.routeGrid, stackRoutes && styles.routeGridStacked]}>
        {routes.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            selected={route.id === selectedRoute}
            stacked={stackRoutes}
            dense={dense}
            onSelect={onSelectRoute}
          />
        ))}
      </View>
    </View>
  );
});

interface RouteCardProps {
  route: PrivatePaymentRouteOption;
  selected: boolean;
  stacked: boolean;
  dense: boolean;
  onSelect: (route: PrivatePaymentRoute) => void;
}

const RouteCard = memo(function RouteCard({
  route,
  selected,
  stacked,
  dense,
  onSelect,
}: RouteCardProps): React.JSX.Element {
  const disabled = route.disabled === true;
  // Drive the selected highlight on the UI thread so the tap feedback
  // is instant and smooth even while the parent recomputes route /
  // fee / valuation state on the JS thread.
  const selectedProgress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    selectedProgress.value = withTiming(selected ? 1 : 0, SELECT_TIMING);
  }, [selected, selectedProgress]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: selectedProgress.value }));

  const handlePress = useCallback(() => {
    if (!disabled) onSelect(route.id);
  }, [disabled, onSelect, route.id]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`Use ${route.label} route`}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.routeCard,
        stacked && styles.routeCardStacked,
        dense && styles.routeCardDense,
        disabled && styles.routeCardDisabled,
        pressed && !disabled && styles.routeCardPressed,
      ]}
    >
      {/* Animated selected background — cross-fades in/out on the UI
          thread; no layout work, so the press never stutters. */}
      <Animated.View pointerEvents="none" style={[styles.routeCardFill, fillStyle]} />
      <Text
        variant="bodyBold"
        color={
          disabled ? colors.text.tertiary : selected ? colors.text.onAccent : colors.text.primary
        }
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={1}
        style={styles.routeTitle}
      >
        {route.label}
      </Text>
      <Text
        variant="small"
        color={
          disabled
            ? colors.text.tertiary
            : selected
              ? colors.brand.deepShadow
              : colors.text.secondary
        }
        align="center"
        numberOfLines={1}
        maxFontSizeMultiplier={1}
        style={styles.routeDescription}
      >
        {disabled ? (route.disabledReason ?? route.description) : route.description}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  routeGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  routeGridStacked: {
    flexDirection: 'column',
  },
  routeCard: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.frostFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxShadow: [
      '0 10px 22px rgba(0, 0, 0, 0.32)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.13)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.24)',
    ].join(', '),
  },
  routeCardStacked: {
    minHeight: 48,
  },
  routeCardDense: {
    minHeight: 46,
    paddingVertical: spacing.xs,
  },
  routeCardFill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.brand.glossAccent,
    borderRadius: radii.lg,
    borderWidth: 0,
  },
  routeCardDisabled: {
    opacity: 0.62,
  },
  routeCardPressed: {
    opacity: 0.78,
  },
  routeTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  routeDescription: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 14,
  },
});
