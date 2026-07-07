import React from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { buildSolscanTxUrl } from '@/lib/solana/solscan';

import type { OffpayNetwork } from '@/types/offpay-api';

interface SolscanTransactionLinkProps {
  signature: string;
  network: OffpayNetwork;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function SolscanTransactionLink({
  signature,
  network,
  accessibilityLabel = 'View transaction on Solscan',
  style,
  textStyle,
}: SolscanTransactionLinkProps): React.JSX.Element {
  const url = buildSolscanTxUrl(signature, network);

  return (
    <Pressable
      onPress={() => {
        void Linking.openURL(url);
      }}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed, style]}
    >
      <Text
        variant="captionBold"
        color={colors.brand.glossAccent}
        style={[styles.hashText, textStyle]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {shortenWalletAddress(signature, 5)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    flex: 1,
    minWidth: 0,
    minHeight: 28,
    justifyContent: 'center',
  },
  linkPressed: {
    opacity: 0.62,
  },
  hashText: {
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'right',
    textDecorationLine: 'underline',
    fontFamily: fontFamily.mono,
  },
});
