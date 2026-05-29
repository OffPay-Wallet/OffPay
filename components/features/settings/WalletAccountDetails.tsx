import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';

interface WalletAccountDetailsProps {
  name: string;
  address: string;
  compact?: boolean;
  dense?: boolean;
}

export function WalletAccountDetails({
  name,
  address,
  compact = false,
  dense = false,
}: WalletAccountDetailsProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text
        variant="bodyBold"
        color={colors.text.primary}
        style={[styles.name, compact && styles.nameCompact, dense && styles.nameDense]}
        numberOfLines={1}
        ellipsizeMode="tail"
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={1.08}
      >
        {name}
      </Text>
      <CopyableAddress
        address={address}
        color={colors.text.secondary}
        iconSize={dense ? 11 : compact ? 12 : 13}
        textStyle={[styles.address, dense && styles.addressDense]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 4,
  },
  name: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  nameCompact: {
    fontSize: 17,
    lineHeight: 22,
  },
  nameDense: {
    fontSize: 16,
    lineHeight: 20,
  },
  address: {
    fontFamily: fontFamily.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  addressDense: {
    fontSize: 11,
    lineHeight: 14,
  },
});
