/**
 * NetworkStep — Solana cluster selector.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SelectableCard } from '@/components/ui/SelectableCard';
import { SOLANA_NETWORKS } from '@/constants/networks';
import { spacing } from '@/constants/spacing';

import type { SolanaNetworkId } from '@/constants/networks';

interface NetworkStepProps {
  selectedNetwork: SolanaNetworkId;
  onSelect: (id: SolanaNetworkId) => void;
}

export function NetworkStep({ selectedNetwork, onSelect }: NetworkStepProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.cards}>
        {SOLANA_NETWORKS.map((n) => (
          <SelectableCard
            key={n.id}
            title={n.label}
            subtitle={n.description}
            selected={n.id === selectedNetwork}
            onPress={() => onSelect(n.id)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  cards: { gap: spacing.sm },
});
