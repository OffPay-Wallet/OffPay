/**
 * Create wallet — choose 12 or 24 word backup phrase (UI only).
 */
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import {
  isWalletFlowInviteFresh,
  WALLET_FLOW_INVITE_PURPOSE,
} from '@/lib/invite/wallet-flow-invite';
import { useAppStore } from '@/store/app';

import type { RecoveryWordCount } from '@/types/wallet';

const WORD_OPTIONS: RecoveryWordCount[] = [12, 24];

function runAfterLoadingPaint(task: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(task, 0);
  });
}

export default function CreateWalletWordCountScreen(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const { source } = useLocalSearchParams<{ source?: string | string[] }>();
  const flowSource = Array.isArray(source) ? source[0] : source;
  const [selected, setSelected] = useState<RecoveryWordCount>(12);
  const [continuing, setContinuing] = useState(false);
  const walletFlowInviteVerifiedAt = useAppStore((s) => s.walletFlowInviteVerifiedAt);
  const clearWalletFlowInviteVerification = useAppStore((s) => s.clearWalletFlowInviteVerification);
  const continueInFlightRef = useRef(false);
  const titleFontSize = width < 360 ? 24 : width < 390 ? 27 : 30;

  useFocusEffect(
    useCallback(() => {
      continueInFlightRef.current = false;
      setContinuing(false);
    }, []),
  );

  function handleBack(): void {
    if (flowSource === 'accounts') {
      clearWalletFlowInviteVerification();
    }

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/onboarding');
    }
  }

  function handleNext(): void {
    if (continueInFlightRef.current) return;

    if (flowSource === 'accounts' && !isWalletFlowInviteFresh(walletFlowInviteVerifiedAt)) {
      clearWalletFlowInviteVerification();
      router.replace({
        pathname: '/invite-code',
        params: {
          purpose: WALLET_FLOW_INVITE_PURPOSE,
          next: 'create-wallet',
          source: 'accounts',
        },
      });
      return;
    }

    continueInFlightRef.current = true;
    setContinuing(true);

    runAfterLoadingPaint(() => {
      try {
        router.push({
          pathname: '/create-wallet/backup-phrase',
          params: { count: String(selected), source: flowSource },
        });
      } catch {
        continueInFlightRef.current = false;
        setContinuing(false);
      }
    });
  }

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
            minimumFontScale={0.82}
          >
            Secret recovery phrase
          </Text>
          <Text variant="caption" color={colors.text.secondary} style={styles.subtitle}>
            Choose how many words your backup phrase will use. More words can increase security for
            some setups.
          </Text>
          <View style={styles.options}>
            {WORD_OPTIONS.map((n) => {
              const isActive = selected === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    setSelected(n);
                  }}
                  style={[
                    styles.optionPill,
                    isActive ? styles.optionPillActive : styles.optionPillIdle,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${n} words`}
                >
                  <View style={styles.optionLabel}>
                    <Text
                      variant="bodyBold"
                      color={colors.text.primary}
                      align="center"
                      style={styles.optionNumber}
                      allowFontScaling={false}
                    >
                      {n}
                    </Text>
                    <Text
                      variant="bodyBold"
                      color={colors.text.primary}
                      align="center"
                      allowFontScaling={false}
                    >
                      {' words'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      }
      footer={
        <View style={styles.buttonsContainer}>
          <GlassActionButton
            label="Continue"
            onPress={handleNext}
            loading={continuing}
            size="compact"
            accessibilityLabel="Continue to backup phrase"
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
    maxWidth: '100%',
  },
  subtitle: {
    marginBottom: spacing['2xl'],
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  optionPill: {
    flex: 1,
    minWidth: layout.avatarLg + spacing['4xl'],
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionPillActive: {
    backgroundColor: colors.glass.accentVeil,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  optionPillIdle: {
    backgroundColor: colors.glass.clearFill,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  optionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionNumber: {
    fontFamily: fontFamily.uiBold,
  },
  buttonsContainer: {
    gap: spacing.md,
  },
});
