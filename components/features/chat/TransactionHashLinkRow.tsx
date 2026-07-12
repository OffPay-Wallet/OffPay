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
 * Compact, left-aligned tx row used inside the timeline result block. The
 * fixed-width label keeps the hashes aligned when several rows stack (e.g. the
 * RWA Delegate / Finalize / Settle signatures).
 */
export function TransactionHashLinkRow({
  label = 'Tx',
  signature,
  network,
  accessibilityLabel = 'View transaction on Solscan',
}: TransactionHashLinkRowProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text variant="small" color={colors.text.tertiary} style={styles.label} numberOfLines={1}>
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
    gap: spacing.sm,
    minHeight: 24,
  },
  label: {
    width: 64,
    flexShrink: 0,
  },
  link: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 24,
  },
  linkText: {
    textAlign: 'left',
  },
});
