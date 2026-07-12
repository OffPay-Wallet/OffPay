import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type { AgenticFlashDepositAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
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
  const started = hasTransactionStarted(action.status);
  const reduceMotion = useReducedMotion();
  const handleConfirm = useCallback(() => onConfirm(action), [action, onConfirm]);
  const handleCancel = useCallback(() => onCancel(action), [action, onCancel]);

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Fund Flash account
          </Text>
          {!started ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {formatPrivateSendStatus(action.status) ?? 'Review one-shot setup and deposit'}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Deposit" value={`${action.amount} ${action.tokenSymbol}`} />
        <ConfirmationRow label="Setup" value="Create missing Flash accounts" />
        <ConfirmationRow label="Destination" value="Flash Trade V2 collateral" />
        <ConfirmationRow label="Network" value="Solana Mainnet" />
      </View>

      {!started ? (
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
      ) : null}

      {started ? (
        <TransactionTimeline
          status={action.status}
          noun="deposit"
          signature={action.signature ?? null}
          errorMessage={action.errorMessage}
          resultContent={
            action.signature != null ? (
              <View style={styles.confirmationRows}>
                <TransactionHashLinkRow
                  signature={action.signature}
                  network={action.network}
                  accessibilityLabel="View Flash funding transaction on Solscan"
                />
              </View>
            ) : null
          }
        />
      ) : action.errorMessage != null ? (
        <Text variant="small" color={colors.semantic.error} style={styles.confirmationError}>
          {action.errorMessage}
        </Text>
      ) : null}

      {canCancel ? (
        <Animated.View
          exiting={reduceMotion ? undefined : FadeOut.duration(160)}
          style={styles.confirmationActions}
        >
          <Pressable
            style={({ pressed }) => [
              styles.secondaryActionButton,
              pressed && styles.actionButtonPressed,
            ]}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel Flash funding"
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
            <Text variant="buttonSmall" color={colors.text.onAccent}>
              Funding disabled
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
