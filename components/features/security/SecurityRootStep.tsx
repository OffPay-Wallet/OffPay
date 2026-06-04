/**
 * SecurityRootStep — root menu for the SecuritySettingsModal.
 * Shows fingerprint toggle, passcode, and wallet keys rows.
 */
import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SettingsRow } from '@/components/features/settings/SettingsRow';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { GlassToggle } from '@/components/ui/GlassToggle';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

/** Aligns section dividers with SettingsRow icon wells (same as main settings list). */
const SECURITY_MENU_DIVIDER_INSET = spacing.lg + 28 + spacing.md;

interface SecurityRootStepProps {
  fingerprintEnabled: boolean;
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

  return (
    <SettingsSectionCard dividerInset={SECURITY_MENU_DIVIDER_INSET}>
      <SettingsRow
        iconNode={<Ionicons name="finger-print" size={iconSize} color={iconColor} />}
        label="Fingerprint"
        subtitle={fingerprintEnabled ? 'Enabled for wallet unlock' : 'Set up fingerprint unlock'}
        rightNode={
          <GlassToggle
            value={fingerprintEnabled}
            onValueChange={onToggleFingerprint}
            accessibilityLabel="Fingerprint toggle"
          />
        }
        compact={compact}
        dense={dense}
        onPress={onToggleFingerprint}
      />

      <SettingsRow
        iconNode={<Ionicons name="lock-closed" size={iconSize} color={iconColor} />}
        label="App Passcode"
        subtitle={hasPasscode ? 'Enabled (6-digit)' : 'Set a 6-digit passcode'}
        compact={compact}
        dense={dense}
        onPress={onGoPasscode}
      />

      <SettingsRow
        iconNode={<Ionicons name="key" size={iconSize} color={iconColor} />}
        label="Wallet Keys"
        subtitle="Reveal private key and recovery phrase"
        compact={compact}
        dense={dense}
        onPress={onGoWalletKeys}
        disabled={!canReveal}
      />
    </SettingsSectionCard>
  );
}
