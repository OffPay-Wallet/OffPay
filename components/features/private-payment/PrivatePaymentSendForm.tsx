import React, { useCallback } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { PillButton } from '@/components/ui/PillButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface PrivatePaymentSendFormProps {
  recipient: string;
  mint: string;
  amount: string;
  effectiveMint: string | null;
  validationMessage: string | null;
  disabledReason: string | null;
  providerLabel: string;
  policyLabel: string;
  stablecoinSymbol: string | null;
  isSubmitting: boolean;
  onRecipientChange: (value: string) => void;
  onMintChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onSubmit: () => void;
}

function sanitizeRawAmount(value: string): string {
  return value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
}

export function PrivatePaymentSendForm({
  recipient,
  mint,
  amount,
  effectiveMint,
  validationMessage,
  disabledReason,
  providerLabel,
  policyLabel,
  stablecoinSymbol,
  isSubmitting,
  onRecipientChange,
  onMintChange,
  onAmountChange,
  onSubmit,
}: PrivatePaymentSendFormProps): React.JSX.Element {
  const handlePasteRecipient = useCallback(async () => {
    const value = await Clipboard.getStringAsync();
    if (value.trim().length > 0) onRecipientChange(value.trim());
  }, [onRecipientChange]);

  const handlePasteMint = useCallback(async () => {
    const value = await Clipboard.getStringAsync();
    if (value.trim().length > 0) onMintChange(value.trim());
  }, [onMintChange]);

  const helperMessage =
    disabledReason ??
    validationMessage ??
    (effectiveMint != null && mint.trim().length === 0
      ? `Using the default ${stablecoinSymbol ?? 'stablecoin'} mint prepared for this wallet.`
      : 'Enter a USDC or USDT amount in raw units so the payment can be verified before signing.');

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text variant="h3" color={colors.text.primary} style={styles.title}>
          Send payment
        </Text>
        <Text variant="small" color={colors.text.secondary} style={styles.subtitle}>
          {providerLabel} protects USDC and USDT transfers. Other tokens can be sent normally, but not privately.
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text variant="small" color={colors.text.tertiary}>
          Recipient wallet
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            value={recipient}
            onChangeText={onRecipientChange}
            placeholder="Solana address"
            placeholderTextColor={colors.text.placeholder}
            style={styles.input}
            selectionColor={colors.brand.azureCyan}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={styles.pasteButton}
            onPress={() => void handlePasteRecipient()}
            accessibilityRole="button"
            accessibilityLabel="Paste recipient address"
          >
            <Text variant="small" color={colors.brand.azureCyan}>
              Paste
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text variant="small" color={colors.text.tertiary}>
          Stablecoin mint
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            value={mint}
            onChangeText={onMintChange}
            placeholder={effectiveMint ?? 'Paste USDC or USDT mint'}
            placeholderTextColor={colors.text.placeholder}
            style={styles.input}
            selectionColor={colors.brand.azureCyan}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={styles.pasteButton}
            onPress={() => void handlePasteMint()}
            accessibilityRole="button"
            accessibilityLabel="Paste token mint"
          >
            <Text variant="small" color={colors.brand.azureCyan}>
              Paste
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text variant="small" color={colors.text.tertiary}>
          Amount in raw units
        </Text>
        <TextInput
          value={amount}
          onChangeText={(value) => onAmountChange(sanitizeRawAmount(value))}
          placeholder="0"
          placeholderTextColor={colors.text.placeholder}
          style={[styles.input, styles.amountInput]}
          selectionColor={colors.brand.azureCyan}
          keyboardType="number-pad"
        />
      </View>

      <Text
        variant="small"
        color={disabledReason != null || validationMessage != null ? colors.semantic.warning : colors.text.tertiary}
        style={styles.helperText}
      >
        {helperMessage}
      </Text>

      <Text variant="small" color={colors.text.tertiary} style={styles.helperText}>
        {policyLabel}
      </Text>

      <PillButton
        label={isSubmitting ? 'Submitting' : 'Review Private Send'}
        variant="primary"
        onPress={onSubmit}
        disabled={isSubmitting || disabledReason != null}
        loading={isSubmitting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.surface.card,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.semiBold,
  },
  subtitle: {
    lineHeight: 18,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: spacing.md,
    minWidth: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    paddingVertical: spacing.md,
  },
  amountInput: {
    borderRadius: radii.md,
    backgroundColor: colors.surface.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.mono,
  },
  pasteButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.holdingsCard.pressed,
    flexShrink: 0,
  },
  helperText: {
    lineHeight: 18,
  },
});
