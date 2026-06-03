/**
 * NetworkStep — Solana cluster selector.
 */
import React from 'react';

import { SelectableCard } from '@/components/ui/SelectableCard';
import { SOLANA_NETWORKS } from '@/constants/networks';

import { PreferenceStepLayout } from './PreferenceStepLayout';

import type { SolanaNetworkId } from '@/constants/networks';

interface NetworkStepProps {
  selectedNetwork: SolanaNetworkId;
  onSelect: (id: SolanaNetworkId) => void;
}

export function NetworkStep({ selectedNetwork, onSelect }: NetworkStepProps): React.JSX.Element {
  return (
    <PreferenceStepLayout>
      {SOLANA_NETWORKS.map((n) => (
        <SelectableCard
          key={n.id}
          title={n.label}
          subtitle={n.description}
          selected={n.id === selectedNetwork}
          onPress={() => onSelect(n.id)}
        />
      ))}
    </PreferenceStepLayout>
  );
}
