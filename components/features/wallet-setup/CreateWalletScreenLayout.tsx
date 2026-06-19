/**
 * Create-wallet flow layout: explicit top/bottom safe area, header, vertically centered body, pinned footer.
 *
 * Uses a flat `brand.glassTint` background — the wallet-setup screens
 * deliberately opt out of the global `GradientBackground` so the
 * frosty surface stays consistent across the entire onboarding flow
 * (welcome → security-setup → create/restore-wallet → privy-wallet).
 * No gradient, no shadow — the tinted base is the design.
 */
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { getViewportProfile } from '@/lib/ui/responsive-layout';

import type { ReactNode } from 'react';
import type { ScrollViewProps } from 'react-native';

interface CreateWalletScreenLayoutProps {
  header: ReactNode;
  /** Centered in the space between header and footer (non-scroll). */
  center: ReactNode;
  /** Pinned to bottom (primary CTA, etc.) */
  footer: ReactNode;
  /** Use when center content may overflow (e.g. 24-word grid). */
  scrollCenter?: boolean;
  scrollViewProps?: ScrollViewProps;
}

export function CreateWalletScreenLayout({
  header,
  center,
  footer,
  scrollCenter = false,
  scrollViewProps,
}: CreateWalletScreenLayoutProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const viewportProfile = getViewportProfile({
    width,
    height,
    fontScale,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
  const hPad = viewportProfile.ultraDense
    ? spacing.md
    : viewportProfile.dense
      ? spacing.lg
      : width < 390
        ? spacing['2xl']
        : layout.screenPaddingHorizontal;
  const compactHeight = viewportProfile.dense;
  const footerBottomPadding = Math.max(
    insets.bottom + spacing.sm,
    compactHeight ? spacing.lg : spacing.xl,
  );

  const shouldScrollBody = scrollCenter || compactHeight;
  const body = shouldScrollBody ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        scrollCenter ? styles.scrollContent : styles.compactScrollContent,
        {
          paddingHorizontal: hPad,
          paddingVertical: compactHeight ? spacing.sm : spacing.md,
        },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      {...scrollViewProps}
    >
      {center}
    </ScrollView>
  ) : (
    <View style={[styles.center, { paddingHorizontal: hPad }]}>{center}</View>
  );

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
        },
      ]}
    >
      <View style={[styles.headerZone, { paddingHorizontal: hPad }]}>{header}</View>
      {body}
      <View
        style={[styles.footerZone, { paddingHorizontal: hPad, paddingBottom: footerBottomPadding }]}
      >
        {footer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand.glassTint,
  },
  headerZone: {
    flexShrink: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  compactScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
  },
  footerZone: {
    flexShrink: 0,
    paddingTop: spacing.md,
  },
});
