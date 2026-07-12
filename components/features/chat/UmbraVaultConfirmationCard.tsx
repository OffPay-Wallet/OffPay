import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import type { AgenticUmbraVaultAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface UmbraVaultConfirmationCardProps {
  action: AgenticUmbraVaultAction;
  onConfirm: (action: AgenticUmbraVaultAction) => void;
  onCancel: (action: AgenticUmbraVaultAction) => void;
}

function getTitle(action: AgenticUmbraVaultAction): string {
  return action.operation === 'shield' ? 'Shield' : 'Withdraw';
}

function getDirection(action: AgenticUmbraVaultAction): string {
  return action.operation === 'shield'
    ? 'Public balance to Umbra vault'
    : 'Umbra vault to public balance';
}

export function UmbraVaultConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: UmbraVaultConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const started = hasTransactionStarted(action.status);
  const reduceMotion = useReducedMotion();
  const statusLabel = formatPrivateSendStatus(action.status);

  const resultContent =
    action.signature != null ? (
      <View style={styles.confirmationRows}>
        <TransactionHashLinkRow
          signature={action.signature}
          network={action.network}
          accessibilityLabel="View Umbra vault transaction on Solscan"
        />
      </View>
    ) : null;

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            {getTitle(action)}
          </Text>
          {!started && statusLabel != null ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {statusLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Amount" value={`${action.amount} ${action.tokenSymbol}`} />
        <ConfirmationRow label="Direction" value={getDirection(action)} />
        <ConfirmationRow
          label="Network"
          value={action.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}
        />
      </View>

      {started ? (
        <TransactionTimeline
          status={action.status}
          noun={action.operation === 'shield' ? 'shield' : 'withdrawal'}
          signature={action.signature ?? null}
          errorMessage={action.errorMessage}
          resultContent={resultContent}
        />
      ) : action.errorMessage != null ? (
        <Text variant="small" color={colors.semantic.error} style={styles.confirmationError}>
          {action.errorMessage}
        </Text>
      ) : null}

      {canAct ? (
        <Animated.View
          exiting={reduceMotion ? undefined : FadeOut.duration(160)}
          style={styles.confirmationActions}
        >
          <Pressable
            style={({ pressed }) => [
              styles.secondaryActionButton,
              pressed && styles.actionButtonPressed,
            ]}
            onPress={() => onCancel(action)}
            accessibilityRole="button"
            accessibilityLabel={`Cancel Umbra ${action.operation}`}
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              pressed && styles.actionButtonPressed,
            ]}
            onPress={() => onConfirm(action)}
            accessibilityRole="button"
            accessibilityLabel={`Confirm Umbra ${action.operation}`}
          >
            <Text variant="buttonSmall" color={colors.text.onAccent}>
              Confirm
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
