/**
 * WalletModeStep — online/offline mode selector.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SelectableCard } from '@/components/ui/SelectableCard';
import { spacing } from '@/constants/spacing';

import type { WalletMode } from '@/store/preferencesStore';

interface WalletModeStepProps {
  walletMode: WalletMode;
  onSelect: (mode: WalletMode) => void;
}

export function WalletModeStep({ walletMode, onSelect }: WalletModeStepProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.cards}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  cards: { gap: spacing.sm },
});
