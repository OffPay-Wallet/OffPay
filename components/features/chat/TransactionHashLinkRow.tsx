import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SolscanTransactionLink } from '@/components/ui/SolscanTransactionLink';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import type { OffpayNetwork } from '@/types/offpay-api';

interface TransactionHashLinkRowProps {
  label?: string;
  signature: string;
  network: OffpayNetwork;
  accessibilityLabel?: string;
}

/**
 * Compact tx row used inside the timeline result block. Multi-step labels keep
 * a small shared width; the default Tx label uses its natural width.
 */
export function TransactionHashLinkRow({
  label = 'Tx',
  signature,
  network,
  accessibilityLabel = 'View transaction on Solscan',
}: TransactionHashLinkRowProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text
        variant="small"
        color={colors.text.tertiary}
        style={[styles.label, label === 'Tx' ? styles.compactLabel : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <SolscanTransactionLink
        signature={signature}
        network={network}
        accessibilityLabel={accessibilityLabel}
        style={styles.link}
        textStyle={styles.linkText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 24,
  },
  label: {
    width: 60,
    flexShrink: 0,
  },
  compactLabel: {
    width: 'auto',
  },
  link: {
    flexShrink: 1,
    minHeight: 24,
  },
  linkText: {
    textAlign: 'left',
  },
});
