import { StyleSheet, View } from 'react-native';

import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { spacing } from '@/constants/spacing';

interface WalletSetupButtonsProps {
  onCreateWallet: () => void;
  onImportWallet: () => void;
}

export function WalletSetupButtons({
  onCreateWallet,
  onImportWallet,
}: WalletSetupButtonsProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <GlassActionButton
        label="Create a new wallet"
        onPress={onCreateWallet}
        size="compact"
      />
      <GlassActionButton
        label="I already have a wallet"
        onPress={onImportWallet}
        variant="secondary"
        size="compact"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    alignSelf: 'stretch',
  },
});
