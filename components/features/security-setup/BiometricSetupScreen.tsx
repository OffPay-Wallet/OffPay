import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';

import { SecuritySetupButton } from '@/components/features/security-setup/SecuritySetupButton';
import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { Text } from '@/components/ui/Text';
import { PuffyFingerprintIcon } from '@/components/ui/icons/PuffyFingerprintIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { authenticateWithBiometrics, getBiometricAvailability } from '@/lib/wallet/biometric-auth';
import { setFingerprintEnabled } from '@/lib/wallet/security-settings';

type SecuritySetupIntent = 'create-wallet' | 'restore-wallet' | 'privy-wallet';

interface BiometricSetupScreenProps {
  intent: SecuritySetupIntent;
}

function finishSetup(intent: SecuritySetupIntent): void {
  if (intent === 'privy-wallet') {
    router.replace({
      pathname: '/privy-wallet',
      params: { source: 'onboarding' },
    });
    return;
  }

  router.replace({
    pathname: intent === 'restore-wallet' ? '/restore-wallet' : '/create-wallet',
    params: { source: 'onboarding' },
  });
}

export function BiometricSetupScreen({ intent }: BiometricSetupScreenProps): React.JSX.Element {
  const { height, width } = useWindowDimensions();
  const compact = height < 740;
  const veryCompact = height < 680;
  const contentMaxWidth = Math.min(420, Math.max(280, width - spacing['3xl'] * 2));
  const fingerprintIconSize = Math.min(56, Math.max(42, Math.round(width * 0.13)));
  const [available, setAvailable] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getBiometricAvailability().then((availability) => {
      if (cancelled) return;
      setAvailable(availability.isAvailable);
      setUnavailableReason(availability.unavailableReason);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (toast == null) return;
    const timeout = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timeout);
  }, [toast]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace({
      pathname: '/security-setup/passcode',
      params: { intent },
    });
  }, [intent]);

  const handleEnable = useCallback(async (): Promise<void> => {
    if (!available || saving) return;
    setSaving(true);
    try {
      const result = await authenticateWithBiometrics({
        promptMessage: 'Enable OffPay fingerprint unlock',
        promptSubtitle: 'Authenticate once to confirm this fingerprint.',
        promptDescription: 'OffPay will still keep your local password as backup.',
      });
      if (!result.success) {
        setToast(result.message ?? 'Fingerprint unlock failed.');
        return;
      }
      await setFingerprintEnabled(true);
      finishSetup(intent);
    } catch (error: unknown) {
      console.error('[BiometricSetup] enable failed:', error);
      setToast('Could not enable fingerprint unlock.');
    } finally {
      setSaving(false);
    }
  }, [available, intent, saving]);

  const handleSkip = useCallback(async (): Promise<void> => {
    try {
      await setFingerprintEnabled(false);
    } catch (error: unknown) {
      console.error('[BiometricSetup] disable failed:', error);
    }
    finishSetup(intent);
  }, [intent]);

  return (
    <CreateWalletScreenLayout
      scrollCenter
      scrollViewProps={{ keyboardShouldPersistTaps: 'handled' }}
      header={<View />}
      center={
        <View
          style={[
            styles.centerBlock,
            {
              maxWidth: contentMaxWidth,
              transform: [{ translateY: veryCompact ? 0 : compact ? spacing.sm : spacing.lg }],
            },
          ]}
        >
          <View style={styles.copyBlock}>
            <PuffyFingerprintIcon
              size={fingerprintIconSize}
              color={colors.brand.glossAccent}
              focused
            />
            <Text variant="h1" color={colors.text.primary} align="center" style={styles.title}>
              Create Fingerprint Unlock
            </Text>
            <Text
              variant="caption"
              color={colors.text.secondary}
              align="center"
              style={styles.subtitle}
            >
              Use your fingerprint to secure your wallet.
            </Text>
            <Text
              variant="captionBold"
              color={colors.text.secondary}
              align="center"
              style={styles.statusText}
            >
              {available
                ? 'Fingerprint is available on this device.'
                : (unavailableReason ?? 'Continue with your local password.')}
            </Text>
          </View>
        </View>
      }
      footer={
        <View style={styles.footer}>
          <View style={styles.toastSlot}>
            {toast != null ? (
              <View style={styles.toast}>
                <Text variant="small" color={colors.text.primary} align="center">
                  {toast}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.buttonGroup}>
            {available ? (
              <SecuritySetupButton
                label={saving ? 'Enabling' : 'Enable Fingerprint'}
                onPress={() => void handleEnable()}
                disabled={saving}
                size="compact"
                icon={
                  <PuffyFingerprintIcon
                    size={layout.iconSizeInline}
                    color={colors.text.primary}
                    focused
                  />
                }
              />
            ) : null}
            <SecuritySetupButton
              label="I'll do it later"
              variant="solidDark"
              onPress={() => void handleSkip()}
              disabled={saving}
              size="compact"
            />
          </View>
          <SecuritySetupButton
            label="Back"
            onPress={handleBack}
            variant="secondary"
            size="compact"
            accessibilityLabel="Back to wallet password setup"
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  centerBlock: {
    width: '100%',
    alignSelf: 'center',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    maxWidth: 360,
  },
  subtitle: {
    maxWidth: 300,
  },
  statusText: {
    marginTop: spacing.xs,
    maxWidth: 320,
  },
  buttonGroup: {
    gap: spacing.md,
  },
  footer: {
    gap: spacing.md,
  },
  toastSlot: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  toast: {
    borderRadius: radii.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
});
