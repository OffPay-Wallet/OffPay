import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type {
  AgenticAdvancedSwapAction,
  AgenticAdvancedSwapCancelAction,
} from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';

interface AdvancedSwapConfirmationCardProps {
  action: AgenticAdvancedSwapAction | AgenticAdvancedSwapCancelAction;
  onConfirm: (action: AgenticAdvancedSwapAction | AgenticAdvancedSwapCancelAction) => void;
  onCancel: (action: AgenticAdvancedSwapAction | AgenticAdvancedSwapCancelAction) => void;
}

function isCancellation(
  action: AgenticAdvancedSwapAction | AgenticAdvancedSwapCancelAction,
): action is AgenticAdvancedSwapCancelAction {
  return action.kind === 'swap_trigger_cancel' || action.kind === 'swap_recurring_cancel';
}

function title(action: AgenticAdvancedSwapAction | AgenticAdvancedSwapCancelAction): string {
  if (action.kind === 'swap_trigger_cancel') return 'Cancel target order';
  if (action.kind === 'swap_recurring_cancel') return 'Cancel recurring order';
  return action.kind === 'swap_trigger' ? 'Create target swap' : 'Create recurring swap';
}

export function AdvancedSwapConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: AdvancedSwapConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const started = hasTransactionStarted(action.status);
  const reduceMotion = useReducedMotion();
  const noun = isCancellation(action) ? 'cancellation' : 'order';
  const handleConfirm = useCallback(() => onConfirm(action), [action, onConfirm]);
  const handleCancel = useCallback(() => onCancel(action), [action, onCancel]);

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            {title(action)}
          </Text>
          {!started ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {formatPrivateSendStatus(action.status) ?? 'Review real mainnet automation'}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        {isCancellation(action) ? (
          <>
            <ConfirmationRow label="Order" value={action.orderId} mono />
            <ConfirmationRow
              label="Pair"
              value={`${action.inputSymbol} → ${action.outputSymbol}`}
            />
            <ConfirmationRow label="Current status" value={action.providerStatus} />
          </>
        ) : (
          <>
            <ConfirmationRow
              label="Total deposit"
              value={`${action.inputAmount} ${action.inputSymbol}`}
            />
            <ConfirmationRow label="Receive" value={action.outputSymbol} />
          </>
        )}
        {action.kind === 'swap_trigger' ? (
          <>
            <ConfirmationRow
              label="Trigger"
              value={`${action.triggerSymbol} ${action.triggerCondition} $${action.triggerPriceUsd}`}
            />
            <ConfirmationRow label="Reference price" value={`$${action.referencePriceUsd}`} />
            <ConfirmationRow label="Slippage" value={`${action.slippageBps / 100}% max`} />
            <ConfirmationRow label="Expires" value={new Date(action.expiresAt).toLocaleString()} />
          </>
        ) : action.kind === 'swap_recurring' ? (
          <>
            <ConfirmationRow
              label="Schedule"
              value={`${action.orderCount} ${action.interval} orders`}
            />
            <ConfirmationRow
              label="Value per order"
              value={`~$${action.perOrderValueUsd.toFixed(2)}`}
            />
          </>
        ) : null}
        <ConfirmationRow label="Network" value="Solana Mainnet" />
      </View>

      {!started && action.warnings.length > 0 ? (
        <View style={styles.confirmationWarnings}>
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
          noun={noun}
          signature={action.signature ?? null}
          errorMessage={action.errorMessage}
          resultContent={
            action.signature != null ? (
              <View style={styles.confirmationRows}>
                <TransactionHashLinkRow
                  signature={action.signature}
                  network={action.network}
                  accessibilityLabel="View Jupiter advanced swap transaction on Solscan"
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
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel advanced swap"
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              {isCancellation(action) ? 'Dismiss' : 'Cancel'}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              pressed && styles.actionButtonPressed,
            ]}
            onPress={handleConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirm advanced swap"
          >
            <Text variant="buttonSmall" color={colors.text.onAccent}>
              {isCancellation(action) ? 'Sign & cancel' : 'Sign & create'}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
