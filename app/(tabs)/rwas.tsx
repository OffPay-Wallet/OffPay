/**
 * RWAs screen — placeholder surface for future tokenized real-world assets.
 * The route is registered so the quick-action menu can link to it; build out
 * the marketplace/portfolio flow here when the feature lands.
 */
import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/ui/GradientBackground';
import { PuffyRwaIcon } from '@/components/ui/icons/PuffyRwaIcon';
import { StaggerRevealGroup } from '@/components/ui/StaggerReveal';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export default function RwasScreen(): React.JSX.Element {
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
          <PuffyRwaIcon size={50} color={colors.text.primary} focused />
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
          RWAs
        </Text>
        <Text
          variant="body"
          color={colors.text.secondary}
          style={styles.subtitle}
          numberOfLines={3}
          maxFontSizeMultiplier={1.1}
        >
          Tokenized real-world assets will open in a dedicated RWA experience.
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
