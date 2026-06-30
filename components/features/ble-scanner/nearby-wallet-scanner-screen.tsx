import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NearbyWalletOrbit } from '@/components/features/ble-scanner/nearby-wallet-orbit';
import { ScannerLottieBlob } from '@/components/features/ble-scanner/scanner-lottie-blob';
import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useNearbyWalletScanner } from '@/hooks/use-nearby-wallet-scanner';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import type { OfflineBleDiscoveredReceiver } from '@/lib/offline/offline-ble-transport';

const SCAN_TIMEOUT_MS = 18_000;
const SCANNER_CONTENT_MAX_WIDTH = 430;
const SCANNER_HEADER_SHADOW =
  '0 14px 30px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const SCANNER_PANEL_SHADOW =
  '0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.14)';

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function ScanButtonLabel({
  scanning,
  idleLabel,
}: {
  scanning: boolean;
  idleLabel: string;
}): React.JSX.Element {
  return (
    <Text
      variant="button"
      color={scanning ? colors.text.tertiary : colors.text.primary}
      numberOfLines={1}
      style={styles.scanButtonText}
    >
      {scanning ? 'Scanning' : idleLabel}
    </Text>
  );
}

export function NearbyWalletScannerScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const params = useLocalSearchParams<{
    mint?: string | string[];
    token?: string | string[];
    amount?: string | string[];
  }>();
  const { receivers, scanning, error, scan } = useNearbyWalletScanner({
    autoStart: true,
    seconds: 5,
    timeoutMs: SCAN_TIMEOUT_MS,
  });
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<string | null>(null);
  const compact = width < 390 || height < 820 || fontScale > 1.05;
  const dense = width < 350 || height < 720 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const horizontalSpace = Math.max(296, width - horizontalPadding * 2);
  const verticalSpace = Math.max(276, height - insets.top - insets.bottom - (dense ? 300 : 340));
  const orbitSize = Math.min(horizontalSpace, verticalSpace, 520);
  const bubbleSize = orbitSize < 340 ? 72 : orbitSize < 390 ? 80 : orbitSize < 450 ? 88 : 96;
  const avatarFootprint = Math.max(42, Math.min(52, bubbleSize * 0.62));
  const blobRoom = orbitSize - avatarFootprint * 2 - spacing['2xl'];
  const desiredBlobSize = orbitSize < 340 ? 216 : orbitSize < 390 ? 272 : 340;
  const blobSize = Math.max(184, Math.min(blobRoom, desiredBlobSize, orbitSize * 0.78));
  const scannerSubtitle =
    receivers.length > 0
      ? `${receivers.length} nearby ${receivers.length === 1 ? 'wallet' : 'wallets'} detected`
      : scanning
        ? 'Scanning nearby OffPay wallets'
        : error != null
          ? 'No nearby wallets. Keep Receive open.'
          : 'Open Receive on the other device';
  const scanButtonLabel = receivers.length > 0 ? 'Scan Again' : 'Scan';
  const scanAccessibilityLabel = scanning ? 'Scanning for nearby wallets' : scanButtonLabel;
  const selectedReceiver =
    receivers.find((receiver) => receiver.walletAddress === selectedWalletAddress) ??
    receivers[0] ??
    null;
  const selectedDisplayLabel =
    selectedReceiver == null
      ? null
      : selectedReceiver.username != null
        ? `@${selectedReceiver.username}`
        : selectedReceiver.displayName;
  const selectedSignalLabel =
    selectedReceiver?.rssi == null ? 'Signal unknown' : `${selectedReceiver.rssi} dBm`;

  useEffect(() => {
    if (receivers.length === 0) {
      setSelectedWalletAddress(null);
      return;
    }

    const selectedStillVisible = receivers.some(
      (receiver) => receiver.walletAddress === selectedWalletAddress,
    );
    if (!selectedStillVisible) {
      setSelectedWalletAddress(receivers[0]?.walletAddress ?? null);
    }
  }, [receivers, selectedWalletAddress]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/private-payment?mode=send' as never);
  }, [router]);

  const handleSendToReceiver = useCallback(
    (receiver: OfflineBleDiscoveredReceiver): void => {
      const searchParams = new URLSearchParams();
      const mint = getParam(params.mint).trim();
      const token = getParam(params.token).trim();
      const amount = getParam(params.amount).trim();

      searchParams.set('mode', 'send');
      searchParams.set('recipient', receiver.walletAddress);
      searchParams.set('bleName', receiver.bleName ?? receiver.displayName);
      searchParams.set('advance', 'amount');

      if (mint.length > 0) searchParams.set('mint', mint);
      if (token.length > 0) searchParams.set('token', token);
      if (amount.length > 0) searchParams.set('amount', amount);

      router.navigate(`/private-payment?${searchParams.toString()}` as never);
    },
    [params.amount, params.mint, params.token, router],
  );

  const handleSelectReceiver = useCallback((receiver: OfflineBleDiscoveredReceiver): void => {
    setSelectedWalletAddress(receiver.walletAddress);
  }, []);

  const handleSendToSelectedReceiver = useCallback((): void => {
    if (selectedReceiver == null) return;
    handleSendToReceiver(selectedReceiver);
  }, [handleSendToReceiver, selectedReceiver]);

  const handleManualScan = useCallback((): void => {
    if (scanning) return;
    void scan();
  }, [scan, scanning]);

  return (
    <View style={styles.container}>
      <GradientBackground />
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + (dense ? spacing.sm : compact ? spacing.md : spacing.lg),
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            paddingHorizontal: horizontalPadding,
            gap: dense ? spacing.md : spacing.lg,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { maxWidth: SCANNER_CONTENT_MAX_WIDTH }]}>
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.controlPressed]}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={6}
          >
            <View
              style={[{ backgroundColor: colors.surface.cardElevated }, styles.headerButtonSurface]}
            >
              <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.text.primary} />
            </View>
          </Pressable>
          <Text
            variant="h2"
            color={colors.text.inverse}
            align="center"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1}
            style={[styles.headerTitle, compact && styles.headerTitleCompact]}
          >
            Nearby Wallets
          </Text>
          <View pointerEvents="none" style={styles.headerButtonPlaceholder} />
        </View>

        <View style={styles.scanArea}>
          <View style={[styles.orbitStage, { width: orbitSize, height: orbitSize }]}>
            <ScannerLottieBlob size={blobSize} />
            <NearbyWalletOrbit
              size={orbitSize}
              blobSize={blobSize}
              bubbleSize={bubbleSize}
              receivers={receivers}
              selectedWalletAddress={selectedReceiver?.walletAddress}
              onSelect={handleSelectReceiver}
            />
          </View>
        </View>

        <Animated.View entering={FadeIn.duration(260).delay(80)} style={styles.footer}>
          <View style={styles.detailsCard}>
            <View
              style={[{ backgroundColor: colors.surface.cardElevated }, StyleSheet.absoluteFill]}
            />
            <View style={styles.receiverRow}>
              <View style={styles.receiverIdentity}>
                <WalletAvatar size={44} solidFill />
                <View style={styles.receiverText}>
                  <Text
                    variant="bodyBold"
                    color={colors.text.primary}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.88}
                    maxFontSizeMultiplier={1.05}
                    style={styles.receiverName}
                  >
                    {selectedDisplayLabel ?? (scanning ? 'Searching...' : 'No wallet found')}
                  </Text>
                  <Text
                    variant="small"
                    color={colors.text.secondary}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    maxFontSizeMultiplier={1}
                    style={[
                      styles.receiverMeta,
                      selectedReceiver == null && styles.receiverMetaEmpty,
                    ]}
                    selectable={selectedReceiver != null || error != null}
                  >
                    {selectedReceiver == null
                      ? scannerSubtitle
                      : `${shortenWalletAddress(selectedReceiver.walletAddress, 4)} • ${selectedSignalLabel}`}
                  </Text>
                </View>
              </View>

              {selectedReceiver == null ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.rescanButton,
                    scanning && styles.scanButtonDisabled,
                    pressed && !scanning && styles.scanButtonPressed,
                  ]}
                  onPress={handleManualScan}
                  disabled={scanning}
                  accessibilityRole="button"
                  accessibilityLabel={scanAccessibilityLabel}
                  accessibilityState={{ busy: scanning, disabled: scanning }}
                >
                  <ScanButtonLabel scanning={scanning} idleLabel={scanButtonLabel} />
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.sendButton, pressed && styles.scanButtonPressed]}
                  onPress={handleSendToSelectedReceiver}
                  accessibilityRole="button"
                  accessibilityLabel={`Send to ${selectedDisplayLabel ?? 'nearby wallet'}`}
                >
                  <Text
                    variant="button"
                    color={colors.text.onAccent}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    maxFontSizeMultiplier={1}
                    style={styles.sendButtonText}
                  >
                    Send
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.text.onAccent} />
                </Pressable>
              )}
            </View>
            {selectedReceiver != null ? (
              <Pressable
                style={({ pressed }) => [
                  styles.scanAgainButton,
                  scanning && styles.scanButtonDisabled,
                  pressed && !scanning && styles.scanButtonPressed,
                ]}
                onPress={handleManualScan}
                disabled={scanning}
                accessibilityRole="button"
                accessibilityLabel={scanAccessibilityLabel}
                accessibilityState={{ busy: scanning, disabled: scanning }}
              >
                <ScanButtonLabel scanning={scanning} idleLabel={scanButtonLabel} />
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  header: {
    width: '100%',
    minHeight: layout.minTouchTarget + spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    zIndex: 1,
  },
  headerButton: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SCANNER_HEADER_SHADOW,
  },
  headerButtonSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.display,
    textAlign: 'center',
  },
  headerTitleCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  headerButtonPlaceholder: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
  },
  scanArea: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    width: '100%',
    paddingBottom: spacing.md,
    flexShrink: 0,
    zIndex: 1,
  },
  detailsCard: {
    width: '100%',
    maxWidth: SCANNER_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    minHeight: 84,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    boxShadow: SCANNER_PANEL_SHADOW,
  },
  receiverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 56,
  },
  receiverIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: spacing.md,
  },
  receiverText: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
  },
  receiverName: {
    lineHeight: 22,
  },
  receiverMeta: {
    lineHeight: 16,
  },
  receiverMetaEmpty: {
    fontSize: 11,
    lineHeight: 14,
  },
  sendButton: {
    minWidth: 88,
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.glossAccent,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  sendButtonText: {
    flexShrink: 1,
    lineHeight: 20,
  },
  rescanButton: {
    width: 104,
    flexShrink: 0,
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  scanAgainButton: {
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  scanButtonPressed: {
    opacity: 0.78,
  },
  scanButtonDisabled: {
    opacity: 0.58,
  },
  scanButtonText: {
    lineHeight: 20,
    textAlign: 'center',
  },
  controlPressed: {
    opacity: 0.72,
  },
});
