/**
 * SecurityRootStep — root menu for the SecuritySettingsModal.
 * Shows fingerprint toggle, passcode, and wallet keys rows.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SettingsLineItem } from '@/components/features/settings/SettingsLineItem';
import { PuffyChevronRightIcon } from '@/components/ui/icons/PuffyChevronRightIcon';
import { PuffyFingerprintIcon } from '@/components/ui/icons/PuffyFingerprintIcon';
import { PuffyKeyIcon } from '@/components/ui/icons/PuffyKeyIcon';
import { PuffyShieldIcon } from '@/components/ui/icons/PuffyShieldIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';

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
  iconSize = layout.iconSizeNav,
  onToggleFingerprint,
  onGoPasscode,
  onGoWalletKeys,
}: SecurityRootStepProps): React.JSX.Element {
  const accessorySize = dense ? 19 : 21;

  return (
    <>
      <SettingsLineItem
        icon={<PuffyFingerprintIcon size={iconSize} color={colors.text.primary} focused />}
        title="Fingerprint"
        subtitle={fingerprintEnabled ? 'Enabled for wallet unlock' : 'Set up fingerprint unlock'}
        right={
          <Pressable
            style={[styles.toggle, fingerprintEnabled ? styles.toggleOn : styles.toggleOff]}
            onPress={onToggleFingerprint}
            accessibilityRole="switch"
            accessibilityLabel="Fingerprint toggle"
            accessibilityState={{ checked: fingerprintEnabled }}
            hitSlop={6}
          >
            <View
              style={[
                styles.toggleKnob,
                fingerprintEnabled ? styles.toggleKnobOn : styles.toggleKnobOff,
              ]}
            />
          </Pressable>
        }
        compact={compact}
        dense={dense}
        onPress={onToggleFingerprint}
      />

      <View style={styles.divider} />

      <SettingsLineItem
        icon={<PuffyShieldIcon size={iconSize} color={colors.text.primary} focused />}
        title="App Passcode"
        subtitle={hasPasscode ? 'Enabled (6-digit)' : 'Set a 6-digit passcode'}
        right={<PuffyChevronRightIcon size={accessorySize} color={colors.text.tertiary} focused />}
        compact={compact}
        dense={dense}
        onPress={onGoPasscode}
      />

      <View style={styles.divider} />

      <SettingsLineItem
        icon={<PuffyKeyIcon size={iconSize} color={colors.text.primary} focused />}
        title="Wallet Keys"
        subtitle="Reveal private key and recovery phrase"
        right={<PuffyChevronRightIcon size={accessorySize} color={colors.text.tertiary} focused />}
        compact={compact}
        dense={dense}
        onPress={onGoWalletKeys}
        disabled={!canReveal}
      />
    </>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
    marginHorizontal: spacing.md,
  },
  toggle: {
    width: layout.buttonHeightMd + spacing.sm,
    height: layout.avatarSm,
    borderRadius: radii.full,
    padding: 3,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.72)',
  },
  toggleOn: {
    backgroundColor: colors.glass.cyanWash,
    borderColor: colors.glass.azureCyanHalf,
    alignItems: 'flex-end',
  },
  toggleOff: {
    backgroundColor: colors.glass.textBacking,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'flex-start',
  },
  toggleKnob: {
    width: layout.iconSizeNav,
    height: layout.iconSizeNav,
    borderRadius: radii.full,
    boxShadow: '0 6px 12px rgba(14, 42, 53, 0.14)',
  },
  toggleKnobOn: { backgroundColor: colors.brand.azureCyan },
  toggleKnobOff: { backgroundColor: colors.glass.strongFill },
});
