import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { PrivatePaymentRoute, PrivatePaymentRouteOption } from './types';

interface PrivateRouteSelectorProps {
  routes: PrivatePaymentRouteOption[];
  selectedRoute: PrivatePaymentRoute | null;
  onSelectRoute: (route: PrivatePaymentRoute) => void;
}

export function PrivateRouteSelector({
  routes,
  selectedRoute,
  onSelectRoute,
}: PrivateRouteSelectorProps): React.JSX.Element | null {
  const { width } = useWindowDimensions();
  if (routes.length === 0 || selectedRoute == null) return null;

  const stackRoutes = width < 340 || routes.length === 1;

  return (
    <View style={styles.section}>
      <View style={[styles.routeGrid, stackRoutes && styles.routeGridStacked]}>
        {routes.map((route) => {
          const selected = route.id === selectedRoute;
          const disabled = route.disabled === true;
          return (
            <Pressable
              key={route.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`Use ${route.label} route`}
              disabled={disabled}
              onPress={() => {
                if (!disabled) onSelectRoute(route.id);
              }}
              style={({ pressed }) => [
                styles.routeCard,
                stackRoutes && styles.routeCardStacked,
                selected && styles.routeCardSelected,
                disabled && styles.routeCardDisabled,
                pressed && !disabled && styles.routeCardPressed,
              ]}
            >
              <Text
                variant="bodyBold"
                color={disabled ? colors.text.tertiary : colors.text.primary}
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
                color={disabled ? colors.text.tertiary : colors.text.secondary}
                align="center"
                numberOfLines={3}
                maxFontSizeMultiplier={1}
                style={styles.routeDescription}
              >
                {disabled ? (route.disabledReason ?? route.description) : route.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  routeGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  routeGridStacked: {
    flexDirection: 'column',
  },
  routeCard: {
    flex: 1,
    minHeight: 74,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  routeCardStacked: {
    minHeight: 66,
  },
  routeCardSelected: {
    borderColor: colors.border.accent,
    backgroundColor: colors.glass.cyanWash,
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
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 14,
  },
});
