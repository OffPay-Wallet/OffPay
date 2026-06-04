/**
 * WalletKeysStep — reveal mnemonic and private key with copy/export actions.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { PillButton } from '@/components/ui/PillButton';
import { Text } from '@/components/ui/Text';
import { PuffyKeyIcon } from '@/components/ui/icons/PuffyKeyIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';

type VisibleSecret = 'mnemonic' | 'privateKey' | null;
type SecretKind = 'mnemonic' | 'privateKey';
type SecretLabel = 'Recovery phrase' | 'Private key';

type PendingSecretAction = { type: 'copy'; value: string; label: SecretLabel } | { type: 'export' };

interface WalletSecretsExportPayload {
  recoveryPhrase: string;
  privateKey: string;
}

interface WalletKeysStepProps {
  walletImportMethod: WalletImportMethod;
  revealMnemonic: string | null;
  revealPrivateKey: string | null;
  visibleSecret: VisibleSecret;
  onToggleVisibleSecret: (secret: VisibleSecret) => void;
  onCopy: (value: string, label: 'Recovery phrase' | 'Private key') => void;
  onExportSecrets: (payload: WalletSecretsExportPayload) => void;
  onToast: (message: string) => void;
  compact?: boolean;
}

interface SecretCardProps {
  title: SecretLabel;
  kind: SecretKind;
  value: string | null;
  visibleSecret: VisibleSecret;
  onToggleVisibleSecret: (secret: VisibleSecret) => void;
  onRequestCopy: (value: string, label: SecretLabel) => void;
  onRequestExport: () => void;
  onToast: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Masking helpers
// ---------------------------------------------------------------------------

function getWalletImportLabel(walletImportMethod: WalletImportMethod): string {
  if (walletImportMethod === 'private-key-import') return 'Imported wallet';
  if (walletImportMethod === 'privy-embedded') return 'Privy wallet';
  return 'Mnemonic wallet';
}

function maskSecret(value: string): string {
  if (value.length <= 12) return '••••••••••••';
  return value.slice(0, 4) + '••••••••••' + value.slice(-4);
}

function maskMnemonic(mnemonic: string): string {
  const words = mnemonic
    .trim()
    .split(/\s+/g)
    .filter((w) => w.length > 0);
  if (words.length <= 4) return '•••• •••• •••• ••••';
  return (
    words[0] +
    ' ' +
    words[1] +
    ' •••• •••• •••• ' +
    words[words.length - 2] +
    ' ' +
    words[words.length - 1]
  );
}

function getMaskedValue(kind: SecretKind, value: string): string {
  return kind === 'mnemonic' ? maskMnemonic(value) : maskSecret(value);
}

function SecretCard({
  title,
  kind,
  value,
  visibleSecret,
  onToggleVisibleSecret,
  onRequestCopy,
  onRequestExport,
  onToast,
}: SecretCardProps): React.JSX.Element {
  const isVisible = visibleSecret === kind;
  const displayValue = value == null ? '-' : isVisible ? value : getMaskedValue(kind, value);

  return (
    <SettingsSectionCard>
      <View style={styles.secretSection}>
      <View style={styles.secretTitleRow}>
        <Text variant="small" color={colors.text.secondary} style={styles.secretTitle}>
          {title}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.eyeBtn, pressed ? styles.pressed : undefined]}
          onPress={() => onToggleVisibleSecret(isVisible ? null : kind)}
          accessibilityRole="button"
          accessibilityLabel={`Toggle ${title.toLowerCase()} visibility`}
          hitSlop={4}
        >
          <Ionicons
            name={isVisible ? 'eye-off-outline' : 'eye-outline'}
            size={layout.iconSizeInline}
            color={colors.text.secondary}
          />
        </Pressable>
      </View>

      <View style={styles.secretValueBox}>
        <Text
          variant="body"
          color={colors.text.primary}
          style={styles.secretValue}
          numberOfLines={kind === 'mnemonic' ? 2 : 1}
          adjustsFontSizeToFit={kind === 'privateKey'}
          minimumFontScale={0.72}
        >
          {displayValue}
        </Text>
      </View>

      <View style={styles.secretActions}>
        <View style={styles.actionSlot}>
          <PillButton
            label="Copy"
            variant="neutral"
            onPress={() => {
              if (value == null) return;
              if (!isVisible) {
                onToast('Tap the eye to reveal first');
                return;
              }
              onRequestCopy(value, title);
            }}
            disabled={value == null}
          />
        </View>
        <View style={styles.actionSlot}>
          <PillButton
            label="Export"
            variant="primary"
            onPress={onRequestExport}
            disabled={value == null}
          />
        </View>
      </View>
      </View>
    </SettingsSectionCard>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WalletKeysStep({
  walletImportMethod,
  revealMnemonic,
  revealPrivateKey,
  visibleSecret,
  onToggleVisibleSecret,
  onCopy,
  onExportSecrets,
  onToast,
  compact = false,
}: WalletKeysStepProps): React.JSX.Element {
  const [pendingAction, setPendingAction] = useState<PendingSecretAction | null>(null);
  const canExportSecrets = revealMnemonic != null && revealPrivateKey != null;
  const isPrivyEmbeddedWallet = walletImportMethod === 'privy-embedded';

  const requestCopy = (value: string, label: SecretLabel): void => {
    setPendingAction({ type: 'copy', value, label });
  };

  const requestExport = (): void => {
    if (!canExportSecrets) {
      onToast('Wallet secrets are not ready to export');
      return;
    }
    setPendingAction({ type: 'export' });
  };

  const confirmCopy = (): void => {
    if (pendingAction?.type !== 'copy') return;
    onCopy(pendingAction.value, pendingAction.label);
    setPendingAction(null);
  };

  const exportAnyway = (): void => {
    if (!canExportSecrets) {
      onToast('Wallet secrets are not ready to export');
      setPendingAction(null);
      return;
    }
    onExportSecrets({ recoveryPhrase: revealMnemonic, privateKey: revealPrivateKey });
    setPendingAction(null);
  };

  const warningTitle =
    pendingAction?.type === 'copy' ? `Copy ${pendingAction.label}?` : 'Export wallet secrets?';
  const warningText =
    pendingAction?.type === 'copy'
      ? 'Your clipboard can be read by other apps. Only continue if you understand the risk.'
      : 'This creates a text file containing your recovery phrase and private key. Store it offline and delete it when finished.';
  const warningIcon = pendingAction?.type === 'copy' ? 'copy-outline' : 'warning-outline';
  const warningConfirmLabel = pendingAction?.type === 'copy' ? 'Copy' : 'Export Anyway';
  const confirmWarning = pendingAction?.type === 'copy' ? confirmCopy : exportAnyway;

  return (
    <View style={[styles.container, compact ? styles.containerCompact : undefined]}>
      <View style={styles.keysBadge}>
        <PuffyKeyIcon size={layout.iconSizeInline} color={colors.text.primary} focused />
        <Text variant="small" color={colors.text.primary} style={styles.keysBadgeText}>
          {getWalletImportLabel(walletImportMethod)}
        </Text>
      </View>

      {isPrivyEmbeddedWallet ? (
        <SettingsSectionCard>
          <View style={styles.privyNotice}>
            <Ionicons
              name="shield-checkmark-outline"
              size={layout.iconSizeInline}
              color={colors.brand.glossAccent}
            />
            <Text variant="small" color={colors.text.secondary} style={styles.privyNoticeText}>
              Privy manages this embedded wallet. OffPay cannot export a recovery phrase or private
              key for it.
            </Text>
          </View>
        </SettingsSectionCard>
      ) : null}

      {pendingAction != null ? (
        <SettingsSectionCard>
          <View style={styles.warningSection}>
            <View style={styles.warningIcon}>
              <Ionicons
                name={warningIcon}
                size={layout.iconSizeInline}
                color={colors.semantic.warning}
              />
            </View>
            <View style={styles.warningContent}>
              <Text variant="body" color={colors.text.primary} style={styles.warningTitle}>
                {warningTitle}
              </Text>
              <Text variant="small" color={colors.text.secondary} style={styles.warningText}>
                {warningText}
              </Text>
              <View
                style={[styles.warningActions, compact ? styles.warningActionsCompact : undefined]}
              >
                <View
                  style={[styles.actionSlot, compact ? styles.warningActionSlotCompact : undefined]}
                >
                  <PillButton
                    label="Cancel"
                    variant="neutral"
                    onPress={() => setPendingAction(null)}
                  />
                </View>
                <View
                  style={[styles.actionSlot, compact ? styles.warningActionSlotCompact : undefined]}
                >
                  <PillButton
                    label={warningConfirmLabel}
                    variant="primary"
                    onPress={confirmWarning}
                  />
                </View>
              </View>
            </View>
          </View>
        </SettingsSectionCard>
      ) : null}

      <SecretCard
        title="Recovery phrase"
        kind="mnemonic"
        value={revealMnemonic}
        visibleSecret={visibleSecret}
        onToggleVisibleSecret={onToggleVisibleSecret}
        onRequestCopy={requestCopy}
        onRequestExport={requestExport}
        onToast={onToast}
      />

      <SecretCard
        title="Private key"
        kind="privateKey"
        value={revealPrivateKey}
        visibleSecret={visibleSecret}
        onToggleVisibleSecret={onToggleVisibleSecret}
        onRequestCopy={requestCopy}
        onRequestExport={requestExport}
        onToast={onToast}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  containerCompact: {
    gap: spacing.xs,
  },
  keysBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    maxWidth: '100%',
  },
  keysBadgeText: {
    fontFamily: fontFamily.medium,
    flexShrink: 1,
    minWidth: 0,
  },
  privyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 0,
  },
  privyNoticeText: {
    flex: 1,
    minWidth: 0,
    lineHeight: 18,
  },
  secretSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    minWidth: 0,
  },
  secretTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minWidth: 0,
  },
  secretTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  eyeBtn: {
    width: layout.buttonHeightSm,
    height: layout.buttonHeightSm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.backgroundTint,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
  },
  secretValueBox: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  secretValue: {
    lineHeight: 20,
    minWidth: 0,
  },
  secretActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionSlot: {
    flex: 1,
    minWidth: 0,
  },
  warningSection: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 0,
  },
  warningIcon: {
    width: layout.buttonHeightSm,
    height: layout.buttonHeightSm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 196, 64, 0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 196, 64, 0.32)',
    flexShrink: 0,
  },
  warningContent: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  warningTitle: {
    fontFamily: fontFamily.uiSemiBold,
    lineHeight: 20,
  },
  warningText: {
    lineHeight: 18,
  },
  warningActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  warningActionsCompact: {
    flexDirection: 'column',
  },
  warningActionSlotCompact: {
    flex: 0,
  },
  pressed: {
    opacity: 0.76,
  },
});
