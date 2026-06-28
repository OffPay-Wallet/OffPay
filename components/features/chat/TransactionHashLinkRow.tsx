import React from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import { buildSolscanTxUrl } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

import type { OffpayNetwork } from '@/types/offpay-api';

interface TransactionHashLinkRowProps {
  label?: string;
  signature: string;
  network: OffpayNetwork;
  accessibilityLabel?: string;
}

export function TransactionHashLinkRow({
  label = 'Tx',
  signature,
  network,
  accessibilityLabel = 'View transaction on Solscan',
}: TransactionHashLinkRowProps): React.JSX.Element {
  const url = buildSolscanTxUrl(signature, network);

  return (
    <View style={styles.confirmationRow}>
      <Text variant="small" color={colors.text.tertiary} style={styles.confirmationRowLabel}>
        {label}
      </Text>
      <Pressable
        onPress={() => {
          void Linking.openURL(url);
        }}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        hitSlop={6}
        style={({ pressed }) => [
          styles.transactionHashLink,
          pressed && styles.transactionHashLinkPressed,
        ]}
      >
        <Text
          variant="captionBold"
          color={colors.brand.glossAccent}
          style={[styles.transactionHashText, styles.monoText]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {shortenWalletAddress(signature, 5)}
        </Text>
      </Pressable>
    </View>
  );
}
