import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { SvgUri } from 'react-native-svg';

import { colors } from '@/constants/colors';
import { Text } from '@/components/ui/Text';
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
  const normalizedLogoUri =
    walletMode === 'offline' ? null : logoUri?.trim() ? logoUri.trim() : null;
  const useSvgLogo = normalizedLogoUri != null && isSvgLogoUri(normalizedLogoUri);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const fallbackPalette = useMemo(() => getTokenFallbackPalette(symbol), [symbol]);

  useEffect(() => {
    setRemoteFailed(false);
  }, [normalizedLogoUri]);

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

      {normalizedLogoUri != null && !remoteFailed && useSvgLogo ? (
        <SvgUri
          uri={normalizedLogoUri}
          width={size}
          height={size}
          style={styles.fill}
          onError={() => setRemoteFailed(true)}
        />
      ) : null}

      {normalizedLogoUri != null && !remoteFailed && !useSvgLogo ? (
        <Image
          source={{ uri: normalizedLogoUri }}
          style={styles.fill}
          contentFit="contain"
          // `expo-image` decodes off-thread, caches in memory + on disk
          // by default, and re-binds cleanly inside FlashList recycler
          // pools when `recyclingKey` is set.
          cachePolicy="memory-disk"
          transition={120}
          recyclingKey={recyclingKey ?? normalizedLogoUri}
          onError={() => setRemoteFailed(true)}
        />
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
