/**
 * Restore wallet input — seed phrase grid or private key input.
 * Uses real BIP39 validation and Solana key derivation.
 *
 * Seed phrase mode:
 *   - 3-column numbered grid (12 or 24 cells)
 *   - Paste button reads clipboard and auto-distributes across cells
 *   - Toggle between 12 and 24 word modes
 *   - Validates against BIP39 English wordlist before import
 *
 * Private key mode:
 *   - Single-line TextInput for pasting the key
 *   - Supports Base58, JSON array, 32-byte seed, 64-byte secret
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import {
  parseSeedPhrase,
  SeedPhraseInputGrid,
} from '@/components/features/wallet-setup/SeedPhraseInputGrid';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { GlassInlineButton } from '@/components/ui/GlassInlineButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import {
  isWalletFlowInviteFresh,
  WALLET_FLOW_INVITE_PURPOSE,
} from '@/lib/invite/wallet-flow-invite';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

import type { RecoveryWordCount } from '@/types/wallet';

type ImportMethod = 'seed-phrase' | 'private-key';

/** Fixed height for toast area — prevents layout shift */
const TOAST_HEIGHT = layout.minTouchTarget;

function parseMethod(raw: string | undefined): ImportMethod {
  if (raw === 'private-key') return 'private-key';
  return 'seed-phrase';
}

function parseFlowSource(raw: string | undefined): 'accounts' | 'onboarding' {
  if (raw === 'accounts') return 'accounts';
  return 'onboarding';
}

function createEmptyWords(count: number): string[] {
  return Array.from({ length: count }, () => '');
}

function runAfterRouteSettles(task: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(task);
  });
}

export default function RestoreWalletInputScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{
    method?: string | string[];
    source?: string | string[];
  }>();
  const rawMethod = params.method;
  const methodParam = Array.isArray(rawMethod) ? rawMethod[0] : rawMethod;
  const method = useMemo(() => parseMethod(methodParam), [methodParam]);
  const rawSource = params.source;
  const sourceParam = Array.isArray(rawSource) ? rawSource[0] : rawSource;
  const flowSource = useMemo(() => parseFlowSource(sourceParam), [sourceParam]);

  const isSeedPhrase = method === 'seed-phrase';
  const setHasOnboarded = useAppStore((s) => s.setHasOnboarded);
  const username = useAppStore((s) => s.username);
  const walletFlowInviteVerifiedAt = useAppStore((s) => s.walletFlowInviteVerifiedAt);
  const clearWalletFlowInviteVerification = useAppStore((s) => s.clearWalletFlowInviteVerification);
  const importFromMnemonic = useWalletStore((s) => s.importFromMnemonic);
  const importFromPrivateKey = useWalletStore((s) => s.importFromPrivateKey);
  const isLoading = useWalletStore((s) => s.isLoading);

  const [wordCount, setWordCount] = useState<RecoveryWordCount>(12);
  const [words, setWords] = useState<string[]>(() => createEmptyWords(12));
  const [privateKey, setPrivateKey] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // Validation
  const filledWords = words.filter((w) => w.length > 0);
  const canImport = isSeedPhrase ? filledWords.length === wordCount : privateKey.trim().length > 0;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear toast timer on unmount
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const handleBack = useCallback((): void => {
    if (flowSource === 'accounts') {
      clearWalletFlowInviteVerification();
    }
    router.back();
  }, [clearWalletFlowInviteVerification, flowSource]);

  /** Toggle word count — preserve existing words */
  const handleWordCountChange = useCallback(
    (count: RecoveryWordCount): void => {
      setWordCount(count);

      if (count > words.length) {
        setWords([...words, ...createEmptyWords(count - words.length)]);
      } else {
        setWords(words.slice(0, count));
      }
    },
    [words],
  );

  const showToast = useCallback((message: string): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  const completeImportFlow = useCallback((): void => {
    if (flowSource === 'accounts') {
      setHasOnboarded(true);
      router.replace('/');
      runAfterRouteSettles(clearWalletFlowInviteVerification);
      return;
    }

    if (username != null) {
      setHasOnboarded(true);
      router.replace('/');
      return;
    }

    router.replace({
      pathname: '/username-setup',
      params: { source: 'onboarding' },
    });
  }, [clearWalletFlowInviteVerification, flowSource, setHasOnboarded, username]);

  const redirectToInviteIfNeeded = useCallback((): boolean => {
    if (flowSource !== 'accounts' || isWalletFlowInviteFresh(walletFlowInviteVerifiedAt)) {
      return false;
    }

    clearWalletFlowInviteVerification();
    router.replace({
      pathname: '/invite-code',
      params: {
        purpose: WALLET_FLOW_INVITE_PURPOSE,
        next: 'restore-wallet',
        source: 'accounts',
      },
    });
    return true;
  }, [clearWalletFlowInviteVerification, flowSource, walletFlowInviteVerifiedAt]);

  /** Read clipboard and distribute into the grid or private key input */
  const handlePaste = useCallback(async (): Promise<void> => {
    try {
      const clipboardContent = await Clipboard.getStringAsync();
      if (clipboardContent.trim().length === 0) {
        showToast('Clipboard is empty');
        return;
      }

      if (isSeedPhrase) {
        const parsed = parseSeedPhrase(clipboardContent);
        if (parsed.length === 0) {
          showToast('No valid words found in clipboard');
          return;
        }

        // Auto-detect word count if pasted phrase is exactly 24 words
        if (parsed.length === 24 && wordCount === 12) {
          setWordCount(24);
          setWords(Array.from({ length: 24 }, (_, i) => parsed[i] ?? ''));
        } else {
          setWords(Array.from({ length: wordCount }, (_, i) => parsed[i] ?? ''));
        }

        const pastedCount = Math.min(parsed.length, wordCount);
        showToast(`Pasted ${pastedCount} word${pastedCount === 1 ? '' : 's'}`);
      } else {
        setPrivateKey(clipboardContent.trim());
        showToast('Pasted from clipboard');
      }
    } catch {
      showToast('Unable to read clipboard');
    }
  }, [isSeedPhrase, wordCount, showToast]);

  /** Import the wallet — validates and stores securely */
  const handleImport = useCallback(async (): Promise<void> => {
    if (isLoading) return;
    if (redirectToInviteIfNeeded()) return;

    if (isSeedPhrase) {
      if (filledWords.length === 0) {
        showToast('Please enter your seed phrase');
        return;
      }
      if (filledWords.length < wordCount) {
        showToast(`Please fill all ${wordCount} words (${filledWords.length}/${wordCount})`);
        return;
      }

      // Build mnemonic from grid words
      const mnemonic = words.slice(0, wordCount).join(' ');

      try {
        await importFromMnemonic(mnemonic);
        completeImportFlow();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid recovery phrase';
        showToast(message);
      }
    } else {
      if (privateKey.trim().length === 0) {
        showToast('Please enter your private key');
        return;
      }

      try {
        await importFromPrivateKey(privateKey.trim());
        completeImportFlow();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Invalid private key';
        showToast(message);
      }
    }
  }, [
    isLoading,
    isSeedPhrase,
    filledWords.length,
    wordCount,
    words,
    privateKey,
    importFromMnemonic,
    importFromPrivateKey,
    completeImportFlow,
    redirectToInviteIfNeeded,
    showToast,
  ]);

  /** Toggle label for switching word count */
  const toggleLabel =
    wordCount === 12 ? 'I have a 24-word recovery phrase' : 'I have a 12-word recovery phrase';

  return (
    <CreateWalletScreenLayout
      scrollCenter
      scrollViewProps={{ keyboardShouldPersistTaps: 'handled' }}
      header={<View />}
      center={
        <View style={styles.centerBlock}>
          <Text variant="h1" color={colors.text.primary} style={styles.title}>
            {isSeedPhrase ? 'Recovery Phrase' : 'Private Key'}
          </Text>
          <Text variant="caption" color={colors.text.secondary} style={styles.subtitle}>
            {isSeedPhrase
              ? `Import an existing wallet with your ${wordCount} or ${wordCount === 12 ? 24 : 12}-word recovery phrase.`
              : 'Paste your Solana wallet private key to import your wallet.'}
          </Text>

          {isSeedPhrase ? (
            <>
              <SeedPhraseInputGrid wordCount={wordCount} words={words} onWordsChange={setWords} />

              {/* Paste + toggle row */}
              <View style={styles.actionRow}>
                <GlassInlineButton
                  label="Paste"
                  onPress={handlePaste}
                  accessibilityLabel="Paste seed phrase from clipboard"
                  icon={
                    <Ionicons
                      name="clipboard-outline"
                      size={layout.iconSizeInline}
                      color={colors.text.primary}
                    />
                  }
                />
              </View>

              <Pressable
                style={styles.toggleBtn}
                onPress={() => handleWordCountChange(wordCount === 12 ? 24 : 12)}
                accessibilityRole="button"
                accessibilityLabel={toggleLabel}
              >
                <Text variant="caption" color={colors.text.secondary}>
                  {toggleLabel}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.inputCard}>
                <TextInput
                  style={styles.textInput}
                  value={privateKey}
                  onChangeText={setPrivateKey}
                  placeholder="Paste your private key..."
                  placeholderTextColor={colors.text.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  selectionColor={colors.brand.glossAccent}
                  keyboardAppearance="dark"
                />
              </View>

              {/* Paste button for private key */}
              <View style={styles.actionRow}>
                <GlassInlineButton
                  label="Paste"
                  onPress={handlePaste}
                  accessibilityLabel="Paste private key from clipboard"
                  icon={
                    <Ionicons
                      name="clipboard-outline"
                      size={layout.iconSizeInline}
                      color={colors.text.primary}
                    />
                  }
                />
              </View>
            </>
          )}
        </View>
      }
      footer={
        <View style={styles.buttonsContainer}>
          {/* Fixed-height toast container — prevents layout shift */}
          <View style={styles.toastContainer}>
            {toast != null ? (
              <View style={styles.toast}>
                <Text variant="small" color={colors.text.primary}>
                  {toast}
                </Text>
              </View>
            ) : null}
          </View>

          <GlassActionButton
            label={isLoading ? 'Importing' : 'Import Wallet'}
            onPress={handleImport}
            disabled={!canImport || isLoading}
            size="compact"
            accessibilityLabel="Import wallet"
          />
          <GlassActionButton
            label="Back"
            onPress={handleBack}
            variant="secondary"
            size="compact"
            accessibilityLabel="Go back"
          />
        </View>
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
    marginBottom: spacing.xl,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  toggleBtn: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  inputCard: {
    backgroundColor: colors.surface.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
  },
  textInput: {
    color: colors.text.primary,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
    minHeight: layout.buttonHeightLg,
  },
  toastContainer: {
    height: TOAST_HEIGHT,
    justifyContent: 'center',
  },
  toast: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.surface.cardElevated,
    alignItems: 'center',
  },
  buttonsContainer: {
    gap: spacing.md,
  },
});
