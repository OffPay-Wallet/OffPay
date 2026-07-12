import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type { AgenticSwapAction } from '@/store/agenticChatStore';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';

import { ConfirmationRow } from './ConfirmationRow';
import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface SwapConfirmationCardProps {
  action: AgenticSwapAction;
  onConfirm: (action: AgenticSwapAction) => void;
  onCancel: (action: AgenticSwapAction) => void;
}

export function SwapConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: SwapConfirmationCardProps): React.JSX.Element {
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
          accessibilityLabel="View swap transaction on Solscan"
        />
      </View>
    ) : null;

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Swap
          </Text>
          {!started && statusLabel != null ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {statusLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Pay" value={`${action.inputAmount} ${action.inputSymbol}`} />
        <ConfirmationRow label="Receive" value={`~${action.outputAmount} ${action.outputSymbol}`} />
        <ConfirmationRow
          label="Minimum receive"
          value={`${formatAtomicAmount(action.minimumOutputAmount, action.outputDecimals)} ${action.outputSymbol}`}
        />
        <ConfirmationRow
          label="Network"
          value={action.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}
        />
        <ConfirmationRow label="Route" value="Normal swap" />
        <ConfirmationRow label="Price impact" value={`${action.priceImpactPct}%`} />
        <ConfirmationRow label="Quote fee" value={action.fee} />
      </View>

      {started ? (
        <TransactionTimeline
          status={action.status}
          noun="swap"
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
            accessibilityLabel="Cancel Yuga swap"
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
            accessibilityLabel="Confirm Yuga swap"
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
