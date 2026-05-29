import { PuffyAvatarIcon } from '@/components/ui/icons/PuffyAvatarIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import React from 'react';
import { StyleSheet, View } from 'react-native';

interface WalletAvatarProps {
  count?: number;
  size?: number;
  solidFill?: boolean;
}

export function WalletAvatar({
  count,
  size = 48,
  solidFill = false,
}: WalletAvatarProps): React.JSX.Element {
  const badgeSize = Math.max(20, size * 0.4);
  const avatar = (
    <PuffyAvatarIcon
      size={size}
      // Match the username-setup avatar tint (brand cyan) so the
      // header silhouette reads as the same identity glyph across
      // the app.
      color={colors.brand.azureCyan}
      focused
      solidFill={solidFill}
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
