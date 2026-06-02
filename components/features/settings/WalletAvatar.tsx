import React, { useCallback } from 'react';
import { ImageSourcePropType, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import {
  deleteManagedProfileImage,
  resolveStoredProfileImageUri,
} from '@/lib/profile/profile-image';
import { useAppStore } from '@/store/app';

const WALLET_PROFILE_ICON =
  require('../../../assets/AppIcons/playstore.png') as ImageSourcePropType;

interface WalletAvatarProps {
  count?: number;
  size?: number;
  solidFill?: boolean;
}

export function WalletAvatar({ count, size = 48 }: WalletAvatarProps): React.JSX.Element {
  const profileImageUri = useAppStore((state) => state.profileImageUri);
  const setProfileImageUri = useAppStore((state) => state.setProfileImageUri);
  const badgeSize = Math.max(20, size * 0.4);
  const avatarSource = profileImageUri != null ? { uri: profileImageUri } : WALLET_PROFILE_ICON;
  const handleAvatarError = useCallback((): void => {
    if (profileImageUri == null) return;
    deleteManagedProfileImage(profileImageUri);
    setProfileImageUri(resolveStoredProfileImageUri(null));
  }, [profileImageUri, setProfileImageUri]);
  const avatar = (
    <Image
      source={avatarSource}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      contentFit="contain"
      cachePolicy="memory-disk"
      priority="high"
      transition={0}
      onError={profileImageUri != null ? handleAvatarError : undefined}
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
    backgroundColor: colors.brand.glassTint,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    boxShadow: [
      '0 5px 14px rgba(0, 0, 0, 0.36)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.14)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.28)',
    ].join(', '),
  },
  container: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: colors.brand.glossAccent,
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
