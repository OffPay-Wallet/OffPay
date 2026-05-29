/**
 * Shopping screen — placeholder surface for a future merchant /
 * marketplace flow. The route is registered so the tab bar can link
 * to it; flesh out the experience here when the feature lands.
 */
import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/ui/GradientBackground';
import { PuffyShoppingIcon } from '@/components/ui/icons/PuffyShoppingIcon';
import { StaggerRevealGroup } from '@/components/ui/StaggerReveal';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export default function ShoppingScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.xl;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <StaggerRevealGroup
        style={[
          styles.content,
          { paddingHorizontal: horizontalPadding, paddingBottom: bottomPadding },
        ]}
      >
        <View style={styles.iconShell}>
          <PuffyShoppingIcon size={48} color={colors.brand.deepShadow} focused />
        </View>
        <Text
          variant="h2"
          color={colors.text.inverse}
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.86}
          maxFontSizeMultiplier={1.05}
        >
          Shopping
        </Text>
        <Text
          variant="body"
          color={colors.text.secondary}
          style={styles.subtitle}
          numberOfLines={3}
          maxFontSizeMultiplier={1.1}
        >
          Pay merchants and browse partner stores. This space is reserved for the upcoming shopping
          experience.
        </Text>
      </StaggerRevealGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  iconShell: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 48,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fontFamily.display,
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
