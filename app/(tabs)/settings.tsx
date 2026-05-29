/**
 * Settings screen — wallet management, security, network, and about sections.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { SettingsScreenContent } from '@/components/features/settings/SettingsScreenContent';

export default function SettingsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const router = useRouter();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);

  const handleBack = (): void => {
    const target =
      previousRoute !== 'index' && previousRoute !== 'settings'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  };

  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing['4xl'];
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const headerFrameWidth = Math.min(430, Math.max(0, windowWidth - horizontalPadding * 2));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <View style={[styles.headerOuter, { paddingHorizontal: horizontalPadding }]}>
        <View style={[styles.header, { width: headerFrameWidth }]}>
          <Pressable
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.headerIconPressed]}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={6}
          >
            <Ionicons
              name="chevron-back"
              size={layout.iconSizeNav}
              color={colors.brand.deepShadow}
            />
          </Pressable>
          <Text
            variant="h2"
            color={colors.text.inverse}
            style={[styles.headerTitle, compact && styles.headerTitleCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.05}
          >
            Settings
          </Text>
          <View style={styles.headerIconPlaceholder} />
        </View>
      </View>

      <SettingsScreenContent bottomPadding={bottomPadding} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  headerOuter: {
    paddingTop: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: 430,
  },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
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
    boxShadow: '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  headerIconPressed: {
    opacity: 0.72,
  },
  headerIconPlaceholder: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  headerTitleCompact: {
    fontSize: 23,
    lineHeight: 30,
  },
});
