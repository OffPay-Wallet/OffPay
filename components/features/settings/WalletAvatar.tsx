import React from 'react';
import { ImageSourcePropType, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

const WALLET_PROFILE_ICON =
  require('../../../assets/wallet_icons/wallet_profile.png') as ImageSourcePropType;

interface WalletAvatarProps {
  count?: number;
  size?: number;
  solidFill?: boolean;
}

export function WalletAvatar({ count, size = 48 }: WalletAvatarProps): React.JSX.Element {
  const badgeSize = Math.max(20, size * 0.4);
  const avatar = (
    <Image
      source={WALLET_PROFILE_ICON}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      contentFit="cover"
      cachePolicy="memory-disk"
      priority="high"
      transition={0}
      accessible={false}
    />
  );

  if (count == null) {
    return avatar;
  }

  return (
    <View style={styles.container}>
      {avatar}
      <View
        style={[
          styles.badge,
          { minWidth: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 },
        ]}
      >
        <Text variant="small" color={colors.text.inverse} style={styles.badgeText}>
          {count}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.brand.iceBlue,
  },
  container: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: colors.brand.azureCyan,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.surface.card,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 'bold',
  },
});
