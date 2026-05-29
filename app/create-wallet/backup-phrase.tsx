/**
 * Secret recovery phrase display — generates a REAL BIP39 mnemonic via @scure/bip39.
 * Shows the words in the RecoveryPhraseGrid and provides copy + confirm actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { RecoveryPhraseGrid } from '@/components/features/wallet-setup/RecoveryPhraseGrid';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { GlassInlineButton } from '@/components/ui/GlassInlineButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

import type { RecoveryWordCount } from '@/types/wallet';

const TOAST_MS = 2200;
const CLIPBOARD_CLEAR_MS = 60_000;

function parseWordCount(raw: string | undefined): RecoveryWordCount {
  if (raw === '24') return 24;
  return 12;
}

function parseFlowSource(raw: string | undefined): 'accounts' | 'onboarding' {
  if (raw === 'accounts') return 'accounts';
  return 'onboarding';
}

export default function BackupPhraseScreen(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ count?: string | string[]; source?: string | string[] }>();
  const rawCount = params.count;
  const countParam = Array.isArray(rawCount) ? rawCount[0] : rawCount;
  const wordCount = useMemo(() => parseWordCount(countParam), [countParam]);
  const rawSource = params.source;
  const sourceParam = Array.isArray(rawSource) ? rawSource[0] : rawSource;
  const flowSource = useMemo(() => parseFlowSource(sourceParam), [sourceParam]);

  const setHasOnboarded = useAppStore((s) => s.setHasOnboarded);
  const username = useAppStore((s) => s.username);
  const createWallet = useWalletStore((s) => s.createWallet);
  const isLoading = useWalletStore((s) => s.isLoading);
  const walletError = useWalletStore((s) => s.error);

  const [words, setWords] = useState<string[]>([]);
  const [toast, setToast] = useState<'copy' | 'save' | 'error' | null>(null);
  const hasGeneratedRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timers + reset loading state on unmount
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
      // If wallet generation was in progress when the user navigated away,
      // reset isLoading so it doesn't stay stuck for the rest of the session.
      if (useWalletStore.getState().isLoading) {
        useWalletStore.setState({ isLoading: false });
      }
    },
    [],
  );

  // Generate the wallet exactly once — ref guard survives Fast Refresh / remounts
  useEffect(() => {
    if (hasGeneratedRef.current) return;
    hasGeneratedRef.current = true;

    let cancelled = false;

    async function generate(): Promise<void> {
      try {
        const mnemonicWords = await createWallet(wordCount);
        if (!cancelled && mnemonicWords.length > 0) {
          setWords(mnemonicWords);
        }
      } catch {
        // Error is already surfaced via walletStore.error state (observed at line 83)
      }
    }

    const generationTask = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) {
        void generate();
      }
    });

    return () => {
      cancelled = true;
      generationTask.cancel();
    };
    // Only run once on mount — wordCount is fixed from nav params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show error toast if wallet generation fails
  useEffect(() => {
    if (walletError != null) {
      setToast('error');
    }
  }, [walletError]);

  useEffect(() => {
    if (toast == null) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const handleBack = useCallback((): void => {
    router.back();
  }, []);

  const handleCopy = useCallback((): void => {
    if (words.length === 0) return;
    void Clipboard.setStringAsync(words.join(' '));
    setToast('copy');

    // Auto-clear clipboard after 60s to reduce secret exposure window
    if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => {
      void Clipboard.setStringAsync('');
    }, CLIPBOARD_CLEAR_MS);
  }, [words]);

  const handleConfirm = useCallback((): void => {
    if (words.length === 0) return;
    if (flowSource === 'accounts') {
      setHasOnboarded(true);
      router.dismissTo('/accounts');
    } else if (username != null) {
      setHasOnboarded(true);
      router.replace('/(tabs)');
    } else {
      router.replace({
        pathname: '/username-setup',
        params: { source: 'onboarding' },
      });
    }
  }, [flowSource, words, setHasOnboarded, username]);

  const toastMessage =
    toast === 'copy'
      ? 'Recovery phrase copied to clipboard.'
      : toast === 'error'
        ? (walletError ?? 'Failed to create wallet')
        : null;

  const canConfirm = words.length > 0 && !isLoading;
  const titleFontSize = width < 360 ? 22 : width < 390 ? 24 : width < 430 ? 26 : 28;

  return (
    <CreateWalletScreenLayout
      scrollCenter
      scrollViewProps={{ keyboardShouldPersistTaps: 'handled' }}
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
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            Secret Recovery Phrase
          </Text>
          <Text variant="caption" color={colors.text.secondary} style={styles.subtitle}>
            This is the only way you will be able to recover your account. Please store it somewhere
            safe!
          </Text>

          {isLoading || words.length === 0 ? (
            <View style={styles.loadingContainer}>
              <Text variant="caption" color={colors.text.secondary} style={styles.loadingText}>
                Generating secure wallet...
              </Text>
            </View>
          ) : (
            <>
              <RecoveryPhraseGrid words={words} />
              <View style={styles.actionsRow}>
                <GlassInlineButton
                  label="Copy"
                  onPress={handleCopy}
                  accessibilityLabel="Copy recovery phrase"
                  icon={
                    <Ionicons
                      name="copy-outline"
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
            {toastMessage != null ? (
              <View style={styles.toast}>
                <Text variant="small" color={colors.text.primary}>
                  {toastMessage}
                </Text>
              </View>
            ) : null}
          </View>

          <GlassActionButton
            label="OK, I saved it somewhere"
            onPress={handleConfirm}
            disabled={!canConfirm}
            size="compact"
            accessibilityLabel="Confirm recovery phrase saved"
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

const TOAST_HEIGHT = layout.minTouchTarget;

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
  loadingContainer: {
    paddingVertical: spacing['3xl'],
    alignItems: 'center',
    gap: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.lg,
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
