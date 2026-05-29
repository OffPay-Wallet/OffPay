/**
 * Restore wallet — choose import method: Seed Phrase or Private Key.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';

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
    label: 'Import Recovery Phrase',
    description: 'Import using your 12 or 24 word recovery phrase',
    icon: 'document-text-outline',
  },
  {
    id: 'private-key',
    label: 'Import Private Key',
    description: 'Import a single-chain Solana account',
    icon: 'key-outline',
  },
];

export default function RestoreWalletMethodScreen(): React.JSX.Element {
  const { source } = useLocalSearchParams<{ source?: string | string[] }>();
  const flowSource = Array.isArray(source) ? source[0] : source;
  const [selected, setSelected] = useState<ImportMethod>('seed-phrase');

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/onboarding');
    }
  }

  function handleContinue(): void {
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
          <Text variant="caption" color={colors.text.secondary} style={styles.subtitle}>
            Import an existing wallet with your recovery phrase or private key.
          </Text>
          <View style={styles.options}>
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
                    isActive ? styles.optionCardActive : styles.optionCardIdle,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={option.label}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      isActive ? styles.iconCircleActive : styles.iconCircleIdle,
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={layout.iconSizeNav}
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
                      numberOfLines={2}
                    >
                      {option.description}
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
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: spacing['2xl'],
    textAlign: 'center',
  },
  options: {
    width: '100%',
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    minWidth: 0,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  optionCardActive: {
    backgroundColor: colors.glass.azureCyanHalf,
    borderColor: colors.glass.rim,
    boxShadow: `0 12px 24px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.82), inset 0 -12px 22px rgba(91, 200, 232, 0.16)`,
  },
  optionCardIdle: {
    backgroundColor: colors.glass.clearFill,
    borderColor: colors.glass.rim,
    boxShadow: `0 10px 20px rgba(14, 42, 53, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.78)`,
  },
  iconCircle: {
    width: layout.avatarMd,
    height: layout.avatarMd,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleActive: {
    backgroundColor: 'rgba(252, 252, 255, 0.38)',
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
