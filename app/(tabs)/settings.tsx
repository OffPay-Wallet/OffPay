/**
 * Settings screen — wallet management, security, network, and about sections.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
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
            variant="h3"
            color={colors.brand.deepShadow}
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
    backgroundColor: colors.brand.iceBlue,
  },
  headerOuter: {
    paddingTop: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.lg,
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
    alignItems: 'center',
    justifyContent: 'center',
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
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  headerTitleCompact: {
    fontSize: 19,
    lineHeight: 25,
  },
});
