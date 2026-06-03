/**
 * WalletModeStep — online/offline mode selector.
 */
import React from 'react';

import { SelectableCard } from '@/components/ui/SelectableCard';

import { PreferenceStepLayout } from './PreferenceStepLayout';

import type { WalletMode } from '@/store/preferencesStore';

interface WalletModeStepProps {
  walletMode: WalletMode;
  onSelect: (mode: WalletMode) => void;
}

export function WalletModeStep({ walletMode, onSelect }: WalletModeStepProps): React.JSX.Element {
  return (
    <PreferenceStepLayout>
      <SelectableCard
        title="Online"
        subtitle="Live payment services"
        selected={walletMode === 'online'}
        onPress={() => onSelect('online')}
      />
      <SelectableCard
        title="Offline"
        subtitle="Offline signing tools"
        selected={walletMode === 'offline'}
        onPress={() => onSelect('offline')}
      />
    </PreferenceStepLayout>
  );
}
