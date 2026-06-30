import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors } from '@/constants/colors';
import { Text } from '@/components/ui/Text';
import { measure, mark } from '@/lib/perf/perf-marks';
import { usePreferencesStore } from '@/store/preferencesStore';

function getTokenFallbackLabel(symbol?: string | null, name?: string | null): string {
  const preferred = symbol?.trim() || name?.trim() || '?';
  const normalized = preferred.toUpperCase();
  return normalized.length <= 5 ? normalized : normalized.charAt(0);
}

function isSvgLogoUri(uri: string): boolean {
  const cleanUri = uri.split('?')[0]?.toLowerCase() ?? uri.toLowerCase();
  return cleanUri.endsWith('.svg') || uri.toLowerCase().includes('image/svg+xml');
}

function isRemoteHttpLogoUri(uri: string | null | undefined): boolean {
  const normalized = uri?.trim().toLowerCase();
  return normalized?.startsWith('http://') === true || normalized?.startsWith('https://') === true;
}

function isOfflineSafeLogoUri(uri: string | null | undefined): boolean {
  const normalized = uri?.trim().toLowerCase();
  if (normalized == null || normalized.length === 0) return false;
  return (
    normalized.startsWith('file://') ||
    normalized.startsWith('content://') ||
    normalized.startsWith('asset://') ||
    normalized.startsWith('data:image/')
  );
}

function getTokenFallbackPalette(symbol?: string | null): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  const normalized = symbol?.trim().toUpperCase();
  if (normalized === 'SOL') {
    return {
      backgroundColor: colors.token.solana,
      borderColor: colors.glass.rim,
      textColor: colors.text.inverse,
    };
  }

  if (normalized === 'USDC' || normalized === 'DUSDC') {
    return {
      backgroundColor: colors.token.usdc,
      borderColor: colors.glass.rim,
      textColor: colors.text.inverse,
    };
  }

  if (normalized === 'USDT' || normalized === 'DUSDT') {
    return {
      backgroundColor: colors.token.usdt,
      borderColor: colors.glass.rim,
      textColor: colors.text.inverse,
    };
  }

  return {
    backgroundColor: colors.glass.accentVeil,
    borderColor: colors.border.strong,
    textColor: colors.text.primary,
  };
}

interface TokenIconProps {
  symbol?: string | null;
  name?: string | null;
  logoUri?: string | null;
  size?: number;
  /**
   * Optional FlashList recycling key. When the parent list recycles a
   * cell into a different token, `expo-image` uses this key to flush
   * the cached image source instead of reusing the previous one.
   */
  recyclingKey?: string | null;
}

export function TokenIcon({
  symbol,
  name,
  logoUri,
  size = 40,
  recyclingKey,
}: TokenIconProps): React.JSX.Element {
  const walletMode = usePreferencesStore((state) => state.walletMode);
  const apiLogoUri = logoUri?.trim() ? logoUri.trim() : null;
  const apiLogoIsSvg = apiLogoUri != null && isSvgLogoUri(apiLogoUri);
  const apiLogoIsRemoteHttp = isRemoteHttpLogoUri(apiLogoUri);
  const apiLogoIsOfflineSafe = isOfflineSafeLogoUri(apiLogoUri);
  const [offlineRemoteCacheReady, setOfflineRemoteCacheReady] = useState(false);
  const remoteBlockedOffline =
    walletMode === 'offline' &&
    apiLogoUri != null &&
    !apiLogoIsOfflineSafe &&
    (!apiLogoIsRemoteHttp || !offlineRemoteCacheReady);
  const normalizedLogoUri =
    apiLogoUri != null && !apiLogoIsSvg && !remoteBlockedOffline ? apiLogoUri : null;
  const [remoteFailed, setRemoteFailed] = useState(false);
  const fallbackPalette = useMemo(() => getTokenFallbackPalette(symbol), [symbol]);

  useEffect(() => {
    setRemoteFailed(false);
  }, [normalizedLogoUri]);

  useEffect(() => {
    let cancelled = false;
    setOfflineRemoteCacheReady(false);

    if (walletMode !== 'offline' || apiLogoUri == null || apiLogoIsSvg || !apiLogoIsRemoteHttp) {
      return () => {
        cancelled = true;
      };
    }

    const startedAt = mark();
    void Image.getCachePathAsync(apiLogoUri)
      .then((cachePath) => {
        if (cancelled) return;
        const cacheHit = cachePath != null;
        setOfflineRemoteCacheReady(cacheHit);
        measure('tokenLogo.cacheHit', startedAt, {
          hit: cacheHit,
          source: 'expo-image',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setOfflineRemoteCacheReady(false);
        measure('tokenLogo.cacheHit', startedAt, {
          hit: false,
          source: 'expo-image',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [apiLogoIsRemoteHttp, apiLogoIsSvg, apiLogoUri, walletMode]);

  useEffect(() => {
    if (normalizedLogoUri != null && !remoteFailed) return;
    measure('tokenLogo.renderFallback', mark(), {
      symbol: symbol?.trim().toUpperCase() ?? null,
      offline: walletMode === 'offline',
      reason: remoteFailed
        ? 'remote-error'
        : apiLogoUri == null
          ? 'missing'
          : apiLogoIsSvg
            ? 'svg'
            : remoteBlockedOffline
              ? 'offline-blocked'
              : 'remote-error',
    });
  }, [
    apiLogoIsSvg,
    apiLogoUri,
    normalizedLogoUri,
    remoteBlockedOffline,
    remoteFailed,
    symbol,
    walletMode,
  ]);

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <View
        style={[
          styles.initialFallback,
          {
            borderRadius: size / 2,
            backgroundColor: fallbackPalette.backgroundColor,
            borderColor: fallbackPalette.borderColor,
          },
        ]}
      >
        <Text
          variant="captionBold"
          color={fallbackPalette.textColor}
          style={[styles.fallbackText, { fontSize: Math.max(9, Math.min(12, size / 4)) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1}
        >
          {getTokenFallbackLabel(symbol, name)}
        </Text>
      </View>

      {normalizedLogoUri != null && !remoteFailed ? (
        <Animated.View
          key={recyclingKey ?? normalizedLogoUri}
          entering={FadeIn.duration(90)}
          style={styles.fill}
        >
          <Image
            source={{ uri: normalizedLogoUri }}
            style={styles.fill}
            contentFit="contain"
            // `expo-image` decodes off-thread, caches in memory + on disk
            // by default, and re-binds cleanly inside FlashList recycler
            // pools when `recyclingKey` is set.
            cachePolicy="memory-disk"
            recyclingKey={recyclingKey ?? normalizedLogoUri}
            onError={() => setRemoteFailed(true)}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  initialFallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  fallbackText: {
    paddingHorizontal: 3,
    textAlign: 'center',
  },
});
