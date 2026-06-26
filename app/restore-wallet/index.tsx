/**
 * Restore wallet — choose import method: Seed Phrase or Private Key.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import {
  isWalletFlowInviteFresh,
  WALLET_FLOW_INVITE_PURPOSE,
} from '@/lib/invite/wallet-flow-invite';
import { useAppStore } from '@/store/app';

import type { ComponentProps } from 'react';

/** Import method identifiers */
type ImportMethod = 'seed-phrase' | 'private-key';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

interface MethodOption {
  id: ImportMethod;
  label: string;
  description: string;
  icon: IoniconsName;
}

const METHOD_OPTIONS: MethodOption[] = [
  {
    id: 'seed-phrase',
    label: 'Recovery Phrase',
    description: '12 or 24 word seed phrase',
    icon: 'document-text-outline',
  },
  {
    id: 'private-key',
    label: 'Private Key',
    description: 'Single Solana account',
    icon: 'key-outline',
  },
];

export default function RestoreWalletMethodScreen(): React.JSX.Element {
  const { source } = useLocalSearchParams<{ source?: string | string[] }>();
  const flowSource = Array.isArray(source) ? source[0] : source;
  const [selected, setSelected] = useState<ImportMethod>('seed-phrase');
  const { width, height } = useWindowDimensions();
  const walletFlowInviteVerifiedAt = useAppStore((s) => s.walletFlowInviteVerifiedAt);
  const clearWalletFlowInviteVerification = useAppStore((s) => s.clearWalletFlowInviteVerification);
  const compact = height < 700 || width < 360;

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

  function handleContinue(): void {
    if (flowSource === 'accounts' && !isWalletFlowInviteFresh(walletFlowInviteVerifiedAt)) {
      clearWalletFlowInviteVerification();
      router.replace({
        pathname: '/invite-code',
        params: {
          purpose: WALLET_FLOW_INVITE_PURPOSE,
          next: 'restore-wallet',
          source: 'accounts',
        },
      });
      return;
    }

    router.push({
      pathname: '/restore-wallet/input',
      params: { method: selected, source: flowSource },
    });
  }

  return (
    <CreateWalletScreenLayout
      scrollCenter
      scrollViewProps={{ keyboardShouldPersistTaps: 'handled' }}
      header={<View />}
      center={
        <View style={styles.centerBlock}>
          <Text variant="h1" color={colors.text.primary} style={styles.title}>
            Import a wallet
          </Text>
          <View style={[styles.options, compact ? styles.optionsCompact : undefined]}>
            {METHOD_OPTIONS.map((option) => {
              const isActive = selected === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    setSelected(option.id);
                  }}
                  style={[
                    styles.optionCard,
                    compact ? styles.optionCardCompact : undefined,
                    isActive ? styles.optionCardActive : styles.optionCardIdle,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={option.label}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      compact ? styles.iconCircleCompact : undefined,
                      isActive ? styles.iconCircleActive : styles.iconCircleIdle,
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={compact ? layout.iconSizeInline : layout.iconSizeNav}
                      color={colors.text.primary}
                    />
                  </View>
                  <View style={styles.optionText}>
                    <Text
                      variant="bodyBold"
                      color={colors.text.primary}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {option.label}
                    </Text>
                    <Text
                      variant="small"
                      color={colors.text.secondary}
                      style={styles.optionDescription}
                      numberOfLines={1}
                    >
                      {option.description}
                    </Text>
                  </View>
                  <Ionicons
                    name={isActive ? 'checkmark-circle' : 'ellipse-outline'}
                    size={layout.iconSizeNav}
                    color={isActive ? colors.brand.glossAccent : colors.text.tertiary}
                  />
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
            onPress={handleContinue}
            size="compact"
            accessibilityLabel="Continue to import"
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
    alignItems: 'center',
  },
  title: {
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  options: {
    width: '100%',
    gap: spacing.md,
  },
  optionsCompact: {
    gap: spacing.sm,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    minWidth: 0,
    minHeight: layout.buttonHeightLg + spacing.lg,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  optionCardCompact: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: layout.buttonHeightLg,
  },
  optionCardActive: {
    backgroundColor: colors.glass.accentVeil,
    borderColor: colors.glass.rim,
    boxShadow: '0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  optionCardIdle: {
    backgroundColor: colors.glass.clearFill,
    borderColor: colors.glass.rimSubtle,
    boxShadow: '0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  iconCircle: {
    width: layout.avatarMd,
    height: layout.avatarMd,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleCompact: {
    width: layout.avatarSm,
    height: layout.avatarSm,
  },
  iconCircleActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  iconCircleIdle: {
    backgroundColor: colors.surface.cardElevated,
  },
  optionText: {
    flex: 1,
    minWidth: 0,
  },
  optionDescription: {
    marginTop: 2,
  },
  buttonsContainer: {
    gap: spacing.md,
  },
});
