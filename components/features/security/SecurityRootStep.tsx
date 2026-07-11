/**
 * SecurityRootStep — root menu for the SecuritySettingsModal.
 * Shows fingerprint toggle, passcode, and wallet keys rows.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SettingsRow } from '@/components/features/settings/SettingsRow';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { GlassToggle } from '@/components/ui/GlassToggle';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

/** Aligns section dividers with SettingsRow icon wells (same as main settings list). */
const SECURITY_MENU_DIVIDER_INSET = spacing.lg + 28 + spacing.md;

interface SecurityRootStepProps {
  fingerprintEnabled: boolean;
  fingerprintBusy: boolean;
  loading: boolean;
  hasPasscode: boolean;
  canReveal: boolean;
  compact?: boolean;
  dense?: boolean;
  iconSize?: number;
  onToggleFingerprint: () => void;
  onGoPasscode: () => void;
  onGoWalletKeys: () => void;
}

export function SecurityRootStep({
  fingerprintEnabled,
  fingerprintBusy,
  loading,
  hasPasscode,
  canReveal,
  compact = false,
  dense = false,
  iconSize = 20,
  onToggleFingerprint,
  onGoPasscode,
  onGoWalletKeys,
}: SecurityRootStepProps): React.JSX.Element {
  const iconColor = colors.text.primary;
  const fingerprintUnavailable = loading || fingerprintBusy;

  return (
    <SettingsSectionCard dividerInset={SECURITY_MENU_DIVIDER_INSET}>
      <SettingsRow
        iconNode={<Ionicons name="finger-print" size={iconSize} color={iconColor} />}
        label="Fingerprint"
        subtitle={
          loading
            ? 'Loading security settings'
            : fingerprintBusy
              ? 'Updating fingerprint setting'
              : fingerprintEnabled
                ? 'Enabled for wallet unlock'
                : 'Set up fingerprint unlock'
        }
        rightNode={
          <View style={styles.fingerprintAction}>
            {fingerprintUnavailable ? (
              <LazyLoadingSpinner size={16} color={colors.text.secondary} />
            ) : null}
            <GlassToggle
              value={fingerprintEnabled}
              onValueChange={onToggleFingerprint}
              disabled={fingerprintUnavailable}
              accessibilityLabel="Fingerprint toggle"
            />
          </View>
        }
        compact={compact}
        dense={dense}
        onPress={onToggleFingerprint}
        disabled={fingerprintUnavailable}
      />

      <SettingsRow
        iconNode={<Ionicons name="lock-closed" size={iconSize} color={iconColor} />}
        label="App Passcode"
        subtitle={hasPasscode ? 'Enabled (6-digit)' : 'Set a 6-digit passcode'}
        compact={compact}
        dense={dense}
        onPress={onGoPasscode}
        disabled={loading}
      />

      <SettingsRow
        iconNode={<Ionicons name="key" size={iconSize} color={iconColor} />}
        label="Wallet Keys"
        subtitle="Reveal private key and recovery phrase"
        compact={compact}
        dense={dense}
        onPress={onGoWalletKeys}
        disabled={loading || !canReveal}
      />
    </SettingsSectionCard>
  );
}

const styles = StyleSheet.create({
  fingerprintAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
