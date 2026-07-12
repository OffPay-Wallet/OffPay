import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type { AgenticUmbraClaimAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface UmbraClaimConfirmationCardProps {
  action: AgenticUmbraClaimAction;
  onConfirm: (action: AgenticUmbraClaimAction) => void;
  onCancel: (action: AgenticUmbraClaimAction) => void;
}

export function UmbraClaimConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: UmbraClaimConfirmationCardProps): React.JSX.Element {
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
          accessibilityLabel="View Umbra claim transaction on Solscan"
        />
      </View>
    ) : null;

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Claim Umbra funds
          </Text>
          {!started && statusLabel != null ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {statusLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Pending claims" value={String(action.claimCount)} />
        <ConfirmationRow label="Destination" value="Umbra encrypted balance" />
        <ConfirmationRow
          label="Network"
          value={action.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}
        />
        {action.settledClaimCount != null ? (
          <ConfirmationRow label="Settled" value={String(action.settledClaimCount)} />
        ) : null}
        {action.remainingClaimCount != null && action.remainingClaimCount > 0 ? (
          <ConfirmationRow label="Still pending" value={String(action.remainingClaimCount)} />
        ) : null}
      </View>

      {started ? (
        <TransactionTimeline
          status={action.status}
          noun="claim"
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
            accessibilityLabel="Cancel Umbra claim"
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
            accessibilityLabel="Confirm Umbra claim"
          >
            <Text variant="buttonSmall" color={colors.text.onAccent}>
              Confirm claim
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
