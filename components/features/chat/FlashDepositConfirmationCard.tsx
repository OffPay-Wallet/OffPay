import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type { AgenticFlashDepositAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';

interface FlashDepositConfirmationCardProps {
  action: AgenticFlashDepositAction;
  onConfirm: (action: AgenticFlashDepositAction) => void;
  onCancel: (action: AgenticFlashDepositAction) => void;
}

export function FlashDepositConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: FlashDepositConfirmationCardProps): React.JSX.Element {
  const canCancel = action.status === 'needs_confirmation';
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;
  const handleConfirm = useCallback(() => onConfirm(action), [action, onConfirm]);
  const handleCancel = useCallback(() => onCancel(action), [action, onCancel]);

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Fund Flash account
          </Text>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {formatPrivateSendStatus(action.status) ?? 'Review one-shot setup and deposit'}
          </Text>
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Deposit" value={`${action.amount} ${action.tokenSymbol}`} />
        <ConfirmationRow label="Setup" value="Create missing Flash accounts" />
        <ConfirmationRow label="Destination" value="Flash Trade V2 collateral" />
        <ConfirmationRow label="Network" value="Solana Mainnet" />
        {action.signature != null ? (
          <TransactionHashLinkRow
            signature={action.signature}
            network={action.network}
            accessibilityLabel="View Flash funding transaction on Solscan"
          />
        ) : null}
      </View>

      <View style={styles.confirmationWarnings}>
        <Text variant="small" color={colors.semantic.error}>
          Flash deposits are disabled while OffPay withdrawal is unavailable. This draft cannot be
          signed or submitted.
        </Text>
        {action.warnings.map((warning) => (
          <Text key={warning} variant="small" color={colors.semantic.warning}>
            {warning}
          </Text>
        ))}
      </View>

      {failed && action.errorMessage != null ? (
        <Text variant="small" color={colors.semantic.error} style={styles.confirmationError}>
          {action.errorMessage}
        </Text>
      ) : null}

      {showActions ? (
        <View style={styles.confirmationActions}>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryActionButton,
              (!canCancel || submitting) && styles.actionButtonDisabled,
              pressed && canCancel && styles.actionButtonPressed,
            ]}
            onPress={handleCancel}
            disabled={!canCancel || submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel Flash funding"
            accessibilityState={{ disabled: !canCancel || submitting }}
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={[styles.primaryActionButton, styles.actionButtonDisabled]}
            onPress={handleConfirm}
            disabled
            accessibilityRole="button"
            accessibilityLabel="Flash funding unavailable"
            accessibilityState={{ disabled: true }}
          >
            {submitting ? (
              <LazyLoadingSpinner size={18} color={colors.brand.deepShadow} />
            ) : (
              <Text variant="buttonSmall" color={colors.text.onAccent}>
                Funding disabled
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
