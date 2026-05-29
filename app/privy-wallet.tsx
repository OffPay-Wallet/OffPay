import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { router } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

type LinkedPrivyWalletCandidate = {
  type?: unknown;
  chain_type?: unknown;
  connector_type?: unknown;
  wallet_client?: unknown;
  address?: unknown;
  public_key?: unknown;
};

function readLinkedPrivySolanaWalletAddress(user: unknown): string | null {
  if (user == null || typeof user !== 'object') return null;

  const linkedAccounts = (user as { linked_accounts?: unknown }).linked_accounts;
  if (!Array.isArray(linkedAccounts)) return null;

  for (const account of linkedAccounts) {
    if (account == null || typeof account !== 'object') continue;

    const candidate = account as LinkedPrivyWalletCandidate;
    const address =
      typeof candidate.address === 'string'
        ? candidate.address
        : typeof candidate.public_key === 'string'
          ? candidate.public_key
          : null;

    if (
      candidate.type === 'wallet' &&
      candidate.chain_type === 'solana' &&
      candidate.connector_type === 'embedded' &&
      candidate.wallet_client === 'privy' &&
      address != null &&
      address.length > 0
    ) {
      return address;
    }
  }

  return null;
}

export default function PrivyWalletRoute(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const { user } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();
  const username = useAppStore((s) => s.username);
  const setHasOnboarded = useAppStore((s) => s.setHasOnboarded);
  const importFromPrivyEmbeddedWallet = useWalletStore((s) => s.importFromPrivyEmbeddedWallet);
  const [error, setError] = useState<string | null>(null);
  const createAttemptedRef = useRef(false);
  const completedRef = useRef(false);
  const titleFontSize = width < 360 ? 24 : width < 390 ? 27 : 30;

  const walletAddress = useMemo(() => {
    if (solanaWallet.status === 'connected') {
      return solanaWallet.wallets[0]?.address ?? solanaWallet.publicKey;
    }

    return readLinkedPrivySolanaWalletAddress(user);
  }, [solanaWallet, user]);

  const finish = useCallback(
    async (address: string): Promise<void> => {
      if (completedRef.current) return;
      completedRef.current = true;

      try {
        await importFromPrivyEmbeddedWallet(address);

        if (username != null) {
          setHasOnboarded(true);
          router.replace('/(tabs)');
          return;
        }

        router.replace({
          pathname: '/username-setup',
          params: { source: 'onboarding' },
        });
      } catch (cause: unknown) {
        completedRef.current = false;
        setError(cause instanceof Error ? cause.message : 'Could not activate Privy wallet.');
      }
    },
    [importFromPrivyEmbeddedWallet, setHasOnboarded, username],
  );

  useEffect(() => {
    if (walletAddress != null && walletAddress.length > 0) {
      void finish(walletAddress);
      return;
    }

    if (user == null) {
      setError('Privy sign-in was not completed.');
      return;
    }

    if (solanaWallet.status === 'not-created' && !createAttemptedRef.current) {
      createAttemptedRef.current = true;
      void solanaWallet
        .create()
        .then((provider) => {
          const createdAddress = provider?._publicKey;
          if (createdAddress != null && createdAddress.length > 0) {
            void finish(createdAddress);
          }
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not create Privy wallet.');
        });
      return;
    }

    if (solanaWallet.status === 'error') {
      setError(solanaWallet.error);
    }
  }, [finish, solanaWallet, user, walletAddress]);

  function handleBack(): void {
    router.replace('/onboarding');
  }

  return (
    <CreateWalletScreenLayout
      scrollCenter
      header={<View />}
      center={
        <View style={styles.centerBlock}>
          <Text
            variant="h1"
            color={colors.text.primary}
            style={[
              styles.title,
              {
                fontSize: titleFontSize,
                lineHeight: titleFontSize + spacing.sm,
              },
            ]}
            align="center"
          >
            Activating Privy Wallet
          </Text>
          <Text variant="caption" color={colors.text.secondary} style={styles.subtitle}>
            {error ?? 'Securing your Privy Solana wallet for OffPay.'}
          </Text>
        </View>
      }
      footer={
        error != null ? (
          <View style={styles.buttonsContainer}>
            <GlassActionButton
              label="Back"
              onPress={handleBack}
              variant="secondary"
              size="compact"
              accessibilityLabel="Back to onboarding"
            />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  centerBlock: {
    width: '100%',
  },
  title: {
    marginBottom: spacing.md,
  },
  subtitle: {
    textAlign: 'center',
  },
  buttonsContainer: {
    gap: spacing.md,
  },
});
