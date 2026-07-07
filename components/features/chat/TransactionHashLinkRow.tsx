import React from 'react';
import { View } from 'react-native';

import { SolscanTransactionLink } from '@/components/ui/SolscanTransactionLink';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

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
  return (
    <View style={styles.confirmationRow}>
      <Text variant="small" color={colors.text.tertiary} style={styles.confirmationRowLabel}>
        {label}
      </Text>
      <SolscanTransactionLink
        signature={signature}
        network={network}
        accessibilityLabel={accessibilityLabel}
        style={styles.confirmationRowLink}
      />
    </View>
  );
}
