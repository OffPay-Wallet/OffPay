import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import {
  SWAP_CONTROL_SHADOW,
  SWAP_GLASS_COLORS,
  SWAP_PANEL_SHADOW,
} from '@/components/features/swap/swapGlass';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { PuffyQRIcon } from '@/components/ui/icons/PuffyQRIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { parseOfflineQrPayload } from '@/lib/offline/offline-payments';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';

import type { BarcodeScanningResult } from 'expo-camera';

interface ScannedPaymentRequest {
  recipient: string;
  amount: string | null;
  token: string | null;
  network?: 'mainnet' | 'devnet' | null;
  route?: 'normal' | 'umbra' | null;
  bleName?: string | null;
  bleServiceUuid?: string | null;
  sessionNonce?: string | null;
}

interface ScanAlertState {
  key: string;
  title: string;
  message: string;
  variant: 'warning' | 'error' | 'info';
}

const QR_ABSENCE_CLEAR_MS = 1400;
const CAMERA_STOP_DELAY_MS = 180;
const SCANNER_CONTENT_MAX_WIDTH = 430;
const SCANNER_CARD_COLORS = [
  colors.brand.whiteStream,
  colors.brand.iceBlue,
  colors.brand.whiteStream,
] as const;
const CAMERA_TINT_COLORS = [
  'rgba(14, 42, 53, 0.22)',
  'rgba(14, 42, 53, 0.04)',
  'rgba(14, 42, 53, 0.28)',
] as const;

function HeaderIconButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <LinearGradient
        colors={[...SWAP_GLASS_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerButtonSurface}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to read this QR.';
}

function buildScanAlertKey(rawValue: string, title: string, message: string): string {
  return `${rawValue}:${title}:${message}`;
}

function scanAlertColor(variant: ScanAlertState['variant']): string {
  if (variant === 'error') return colors.semantic.error;
  if (variant === 'info') return colors.brand.azureCyan;
  return colors.semantic.warning;
}

function parsePaymentQr(rawValue: string): ScannedPaymentRequest {
  const raw = rawValue.trim();
  if (raw.length === 0) {
    throw new Error('QR payload is empty.');
  }

  if (isValidSolanaAddress(raw)) {
    return {
      recipient: raw,
      amount: null,
      token: null,
      route: null,
    };
  }

  const parsed = parseOfflineQrPayload(raw);
  if (
    parsed.type === 'solana-address' ||
    parsed.type === 'offpay-receive-request' ||
    parsed.type === 'offpay-offline-request' ||
    parsed.type === 'nonce-payment-request'
  ) {
    return {
      recipient: parsed.request.recipient,
      amount: parsed.request.amount,
      token: parsed.request.token,
      network: 'network' in parsed.request ? parsed.request.network : null,
      route: 'route' in parsed.request ? parsed.request.route : null,
      bleName: 'bleName' in parsed.request ? parsed.request.bleName : null,
      bleServiceUuid: 'bleServiceUuid' in parsed.request ? parsed.request.bleServiceUuid : null,
      sessionNonce: 'sessionNonce' in parsed.request ? parsed.request.sessionNonce : null,
    };
  }

  throw new Error('This QR is not a wallet payment request.');
}

/**
 * Build a typed expo-router `Href` for the private-payment send flow
 * from a parsed QR request. Returning `{ pathname, params }` instead
 * of a query-string concatenation lets `router.navigate` accept the
 * value with no cast.
 *
 * `params` values are typed as `string` because `useLocalSearchParams`
 * on the receiving screen receives them as strings — coercing here
 * would just round-trip them.
 */
function buildSendRoute(params: {
  request: ScannedPaymentRequest;
  fallbackMint: string;
}): Href {
  const search: Record<string, string> = {
    mode: 'send',
    recipient: params.request.recipient,
  };

  const token = params.request.token?.trim() || params.fallbackMint.trim();
  if (token.length > 0) {
    if (isValidSolanaAddress(token)) {
      search.mint = token;
    } else {
      search.token = token.toUpperCase();
    }
  }

  const amount = params.request.amount?.trim();
  if (amount != null && amount.length > 0) {
    search.amount = amount;
  }
  const bleName = params.request.bleName?.trim();
  if (bleName != null && bleName.length > 0) {
    search.bleName = bleName;
  }
  const bleServiceUuid = params.request.bleServiceUuid?.trim();
  if (bleServiceUuid != null && bleServiceUuid.length > 0) {
    search.bleServiceUuid = bleServiceUuid;
  }
  const sessionNonce = params.request.sessionNonce?.trim();
  if (sessionNonce != null && sessionNonce.length > 0) {
    search.qrSession = sessionNonce;
  }
  if (params.request.route === 'umbra' || params.request.route === 'normal') {
    search.route = params.request.route;
  }

  return {
    pathname: '/private-payment',
    params: search,
  };
}

export function ScannerScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const params = useLocalSearchParams<{ mint?: string }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);
  const { network, unsupportedReason } = useOffpayNetwork();
  const [cameraActive, setCameraActive] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanAlert, setScanAlert] = useState<ScanAlertState | null>(null);
  const autoRequestedPermissionRef = useRef(false);
  const scanAlertClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraActivationTaskRef = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);
  const cameraStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackMint = typeof params.mint === 'string' ? params.mint : '';
  const compact = width < 390 || height < 760 || fontScale > 1.08;
  const dense = width < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const contentMaxWidth = Math.min(
    Math.max(width - horizontalPadding * 2, 0),
    SCANNER_CONTENT_MAX_WIDTH,
  );
  const guideHorizontalInset = Math.max((width - contentMaxWidth) / 2, horizontalPadding);
  const scanGuideTop =
    insets.top + layout.minTouchTarget + (dense ? spacing['2xl'] : spacing['4xl']);
  const scanGuideBottom =
    Math.max(insets.bottom, spacing.lg) +
    layout.tabBarHeight +
    (dense ? spacing['3xl'] : spacing['4xl']);

  const cancelCameraActivation = useCallback(() => {
    cameraActivationTaskRef.current?.cancel?.();
    cameraActivationTaskRef.current = null;
  }, []);

  const scheduleCameraActivation = useCallback(() => {
    if (cameraStopTimerRef.current != null) {
      clearTimeout(cameraStopTimerRef.current);
      cameraStopTimerRef.current = null;
    }

    cancelCameraActivation();
    cameraActivationTaskRef.current = InteractionManager.runAfterInteractions(() => {
      cameraActivationTaskRef.current = null;
      requestAnimationFrame(() => setCameraActive(true));
    });
  }, [cancelCameraActivation]);

  const stopCameraAfterTransition = useCallback(() => {
    cancelCameraActivation();
    if (cameraStopTimerRef.current != null) {
      clearTimeout(cameraStopTimerRef.current);
    }

    cameraStopTimerRef.current = setTimeout(() => {
      cameraStopTimerRef.current = null;
      setCameraActive(false);
    }, CAMERA_STOP_DELAY_MS);
  }, [cancelCameraActivation]);

  useEffect(() => {
    if (cameraPermission?.granted === true) {
      return;
    }

    if (cameraPermission?.canAskAgain === false || autoRequestedPermissionRef.current) {
      return;
    }

    autoRequestedPermissionRef.current = true;
    void requestCameraPermission().then((permission) => {
      if (permission.granted) {
        scheduleCameraActivation();
      }
    });
  }, [
    cameraPermission?.canAskAgain,
    cameraPermission?.granted,
    requestCameraPermission,
    scheduleCameraActivation,
  ]);

  useEffect(
    () => () => {
      cancelCameraActivation();
      if (cameraStopTimerRef.current != null) {
        clearTimeout(cameraStopTimerRef.current);
        cameraStopTimerRef.current = null;
      }
    },
    [cancelCameraActivation],
  );

  useFocusEffect(
    useCallback(() => {
      setHasScanned(false);
      setScanAlert(null);
      if (cameraPermission?.granted === true) {
        scheduleCameraActivation();
      }

      return () => {
        stopCameraAfterTransition();
        if (scanAlertClearTimerRef.current != null) {
          clearTimeout(scanAlertClearTimerRef.current);
          scanAlertClearTimerRef.current = null;
        }
      };
    }, [cameraPermission?.granted, scheduleCameraActivation, stopCameraAfterTransition]),
  );

  const helperText = useMemo(() => {
    if (network == null) return unsupportedReason ?? 'This network is not supported.';
    if (cameraPermission?.canAskAgain === false && cameraPermission.granted !== true) {
      return 'Camera access is off.';
    }
    return 'Scanning automatically';
  }, [cameraPermission?.canAskAgain, cameraPermission?.granted, network, unsupportedReason]);

  const handleBack = useCallback(() => {
    const target =
      previousRoute !== 'index' && previousRoute !== 'scanner'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  }, [previousRoute, router]);

  const clearScanAlert = useCallback(() => {
    if (scanAlertClearTimerRef.current != null) {
      clearTimeout(scanAlertClearTimerRef.current);
      scanAlertClearTimerRef.current = null;
    }
    setScanAlert(null);
  }, []);

  const holdScanAlert = useCallback((alert: ScanAlertState) => {
    if (scanAlertClearTimerRef.current != null) {
      clearTimeout(scanAlertClearTimerRef.current);
      scanAlertClearTimerRef.current = null;
    }

    setScanAlert((current) => (current?.key === alert.key ? current : alert));
    scanAlertClearTimerRef.current = setTimeout(() => {
      scanAlertClearTimerRef.current = null;
      setScanAlert((current) => (current?.key === alert.key ? null : current));
    }, QR_ABSENCE_CLEAR_MS);
  }, []);

  const getRequestScanAlert = useCallback(
    (request: ScannedPaymentRequest): Omit<ScanAlertState, 'key'> | null => {
      if (network == null) {
        return {
          title: 'Unsupported network',
          message: unsupportedReason ?? 'This network is not supported.',
          variant: 'warning',
        };
      }

      if (request.network != null && request.network !== network) {
        return {
          title: 'Wrong network',
          message: `Switch to ${request.network === 'mainnet' ? 'Mainnet' : 'Devnet'} for this QR.`,
          variant: 'warning',
        };
      }

      return null;
    },
    [network, unsupportedReason],
  );

  const handleCameraQr = useCallback(
    (result: BarcodeScanningResult) => {
      if (hasScanned) return;
      const rawValue = result.data.trim();

      try {
        const request = parsePaymentQr(rawValue);
        const requestAlert = getRequestScanAlert(request);

        if (requestAlert != null) {
          holdScanAlert({
            key: buildScanAlertKey(rawValue, requestAlert.title, requestAlert.message),
            ...requestAlert,
          });
          return;
        }

        clearScanAlert();
        setHasScanned(true);
        const sendRoute = buildSendRoute({ request, fallbackMint });
        router.navigate(sendRoute);
      } catch (error) {
        const message = getErrorMessage(error);
        holdScanAlert({
          key: buildScanAlertKey(rawValue, 'Unsupported QR', message),
          title: 'Unsupported QR',
          message,
          variant: 'warning',
        });
      }
    },
    [clearScanAlert, fallbackMint, getRequestScanAlert, hasScanned, holdScanAlert, router],
  );

  const handleOpenCamera = useCallback(async () => {
    if (cameraPermission?.granted !== true) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        showToast({
          title: 'Camera permission needed',
          message: 'Allow camera access to scan QR codes.',
          variant: 'warning',
        });
        return;
      }
    }

    setHasScanned(false);
    scheduleCameraActivation();
  }, [cameraPermission?.granted, requestCameraPermission, scheduleCameraActivation, showToast]);

  return (
    <View style={styles.container}>
      <GradientBackground />
      {cameraActive ? (
        <Animated.View
          entering={FadeIn.duration(220)}
          exiting={FadeOut.duration(160)}
          style={StyleSheet.absoluteFill}
        >
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={hasScanned ? undefined : handleCameraQr}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[...CAMERA_TINT_COLORS]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(140)}
          style={[styles.permissionFallback, { paddingHorizontal: horizontalPadding }]}
        >
          <LinearGradient
            colors={[...SCANNER_CARD_COLORS]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.permissionCard, { maxWidth: contentMaxWidth }]}
          >
            <View style={styles.permissionIcon}>
              <PuffyQRIcon size={layout.iconSizeTab} color={colors.brand.azureCyan} />
            </View>
            <Text variant="bodyBold" color={colors.text.primary} align="center">
              Camera ready
            </Text>
            <Text
              variant="caption"
              color={colors.text.secondary}
              align="center"
              style={styles.permissionText}
            >
              {helperText}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}
              onPress={handleOpenCamera}
              accessibilityRole="button"
              accessibilityLabel="Open camera scanner"
            >
              <LinearGradient
                colors={[colors.brand.azureCyan, colors.glass.azureCyanHalf, colors.glass.cyanWash]}
                start={{ x: 0.04, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.permissionButtonSurface}
              >
                <Text variant="button" color={colors.text.primary}>
                  Open Scanner
                </Text>
              </LinearGradient>
            </Pressable>
          </LinearGradient>
        </Animated.View>
      )}

      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(120)}
        pointerEvents="box-none"
        style={[styles.overlay, { paddingTop: insets.top + spacing.md }]}
      >
        <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
          <HeaderIconButton onPress={handleBack} accessibilityLabel="Go back">
            <Ionicons
              name="chevron-back"
              size={layout.iconSizeNav}
              color={colors.brand.deepShadow}
            />
          </HeaderIconButton>
          <Text
            variant="h2"
            color={colors.text.inverse}
            style={styles.headerTitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1}
          >
            Scan QR
          </Text>
          <HeaderIconButton onPress={handleOpenCamera} accessibilityLabel="Restart scanner">
            <Ionicons
              name="scan-outline"
              size={layout.iconSizeNav}
              color={colors.brand.deepShadow}
            />
          </HeaderIconButton>
        </View>

        {cameraActive ? (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.scanGuide,
                {
                  marginHorizontal: guideHorizontalInset,
                  marginTop: scanGuideTop,
                  marginBottom: scanGuideBottom,
                },
              ]}
            >
              <View style={styles.scanFrameSurface} />
              <View style={styles.scanCorner} />
              <View style={[styles.scanCorner, styles.scanCornerRight]} />
              <View style={[styles.scanCorner, styles.scanCornerBottom]} />
              <View style={[styles.scanCorner, styles.scanCornerBottomRight]} />
            </View>

            <View
              pointerEvents="none"
              style={[
                styles.bottomHint,
                {
                  paddingHorizontal: horizontalPadding,
                  paddingBottom: Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight,
                },
              ]}
            >
              {scanAlert != null ? (
                <Animated.View
                  key={scanAlert.key}
                  entering={FadeIn.duration(140)}
                  exiting={FadeOut.duration(120)}
                  style={[styles.bottomHintContent, { maxWidth: contentMaxWidth }]}
                >
                  <LinearGradient
                    colors={[...SCANNER_CARD_COLORS]}
                    start={{ x: 0.04, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.scanAlertCard}
                  >
                    <View
                      style={[
                        styles.scanAlertIndicator,
                        { backgroundColor: scanAlertColor(scanAlert.variant) },
                      ]}
                    />
                    <View style={styles.scanAlertText}>
                      <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
                        {scanAlert.title}
                      </Text>
                      <Text variant="caption" color={colors.text.secondary} numberOfLines={2}>
                        {scanAlert.message}
                      </Text>
                    </View>
                  </LinearGradient>
                </Animated.View>
              ) : (
                <LinearGradient
                  colors={[...SCANNER_CARD_COLORS]}
                  start={{ x: 0.04, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.statusPill, { maxWidth: contentMaxWidth }]}
                >
                  <Text variant="captionBold" color={colors.text.primary} align="center">
                    {hasScanned ? 'Opening Send' : helperText}
                  </Text>
                </LinearGradient>
              )}
            </View>
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  permissionFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
    gap: spacing.md,
  },
  permissionCard: {
    width: '100%',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.whiteStream,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    boxShadow: SWAP_PANEL_SHADOW,
  },
  permissionIcon: {
    width: layout.avatarLg,
    height: layout.avatarLg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.cyanWash,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    maxWidth: 280,
    lineHeight: 20,
  },
  permissionButton: {
    minHeight: layout.buttonHeightLg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.brand.azureCyan,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  permissionButtonSurface: {
    minHeight: layout.buttonHeightLg,
    paddingHorizontal: spacing['3xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  header: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.semiBold,
  },
  headerButton: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.brand.whiteStream,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  headerButtonSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanGuide: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
  },
  scanFrameSurface: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(252, 252, 255, 0.28)',
    backgroundColor: 'rgba(252, 252, 255, 0.04)',
    boxShadow: `inset 0 1px 1px rgba(255, 255, 255, 0.42), inset 0 -12px 28px rgba(14, 42, 53, 0.08)`,
  },
  scanCorner: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 64,
    height: 64,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: colors.brand.azureCyan,
    borderTopLeftRadius: radii.lg,
  },
  scanCornerRight: {
    left: undefined,
    right: 0,
    borderLeftWidth: 0,
    borderRightWidth: 4,
    borderTopLeftRadius: 0,
    borderTopRightRadius: radii.lg,
  },
  scanCornerBottom: {
    top: undefined,
    bottom: 0,
    borderTopWidth: 0,
    borderBottomWidth: 4,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: radii.lg,
  },
  scanCornerBottomRight: {
    top: undefined,
    left: undefined,
    right: 0,
    bottom: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderTopLeftRadius: 0,
    borderBottomRightRadius: radii.lg,
  },
  bottomHint: {
    alignItems: 'center',
  },
  bottomHintContent: {
    width: '100%',
  },
  scanAlertCard: {
    width: '100%',
    minHeight: 76,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    boxShadow: SWAP_PANEL_SHADOW,
  },
  statusPill: {
    width: '100%',
    minHeight: layout.buttonHeightSm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  scanAlertIndicator: {
    width: 12,
    height: 12,
    borderRadius: radii.full,
  },
  scanAlertText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.76,
  },
});
