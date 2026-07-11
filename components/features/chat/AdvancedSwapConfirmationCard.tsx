import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type {
  AgenticAdvancedSwapAction,
  AgenticAdvancedSwapCancelAction,
} from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
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
            {title(action)}
          </Text>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {formatPrivateSendStatus(action.status) ?? 'Review real mainnet automation'}
          </Text>
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
        {action.signature != null ? (
          <TransactionHashLinkRow
            signature={action.signature}
            network={action.network}
            accessibilityLabel="View Jupiter advanced swap transaction on Solscan"
          />
        ) : null}
      </View>

      <View style={styles.confirmationWarnings}>
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
              (!canAct || submitting) && styles.actionButtonDisabled,
              pressed && canAct && styles.actionButtonPressed,
            ]}
            onPress={handleCancel}
            disabled={!canAct || submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel advanced swap"
            accessibilityState={{ disabled: !canAct || submitting }}
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              {isCancellation(action) ? 'Dismiss' : 'Cancel'}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              (!canAct || submitting) && styles.actionButtonDisabled,
              pressed && canAct && styles.actionButtonPressed,
            ]}
            onPress={handleConfirm}
            disabled={!canAct || submitting}
            accessibilityRole="button"
            accessibilityLabel="Confirm advanced swap"
            accessibilityState={{ disabled: !canAct || submitting }}
          >
            {submitting ? (
              <LazyLoadingSpinner size={18} color={colors.brand.deepShadow} />
            ) : (
              <Text variant="buttonSmall" color={colors.text.onAccent}>
                {isCancellation(action) ? 'Sign & cancel' : 'Sign & create'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
