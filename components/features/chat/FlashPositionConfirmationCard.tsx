import React, { useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import type { FlashEncodedAmount } from '@/lib/flash-trade/types';
import type {
  AgenticFlashPositionAction,
  AgenticFlashTriggerOrderSummary,
} from '@/store/agenticChatStore';

import { ConfirmationRow } from './ConfirmationRow';
import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface FlashPositionConfirmationCardProps {
  action: AgenticFlashPositionAction;
  onConfirm: (action: AgenticFlashPositionAction) => void;
  onCancel: (action: AgenticFlashPositionAction) => void;
}

function formatLeverage(leverage: number): string {
  return `${leverage.toFixed(1)}x`;
}

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$0.00';
  if (amount >= 1000) {
    return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatSignedUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '$0.00';
  const prefix = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${prefix}${formatUsd(Math.abs(amount))}`;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return 'Pending';
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  return `$${price.toFixed(price < 1 ? 4 : 2)}`;
}

function getSideLabel(side: 'long' | 'short'): string {
  return side === 'long' ? 'Long' : 'Short';
}

function getSideColor(side: 'long' | 'short'): string {
  return side === 'long' ? colors.semantic.receive : colors.semantic.error;
}

function formatTriggerOrder(order: AgenticFlashTriggerOrderSummary): string {
  const label = order.orderType === 'take_profit' ? 'TP' : 'SL';
  return `${label} ${formatPrice(order.triggerPrice)} / ${order.sizePercent}%`;
}

function formatTriggerOrders(orders: readonly AgenticFlashTriggerOrderSummary[]): string {
  return orders.map(formatTriggerOrder).join(' / ');
}

function formatEncodedAmount(amount: FlashEncodedAmount): string {
  return `${formatAtomicAmount(amount.rawAmount, amount.decimals, amount.decimals)} ${amount.symbol}`;
}

function amountLabel(action: AgenticFlashPositionAction): string {
  if (action.operation === 'open_position' || action.operation === 'reverse_position') {
    return `${getSideLabel(action.side)} ${formatUsd(action.sizeUsd)}`;
  }
  if (action.amountUsd != null) {
    const suffix = action.amountTokenSymbol != null ? ` ${action.amountTokenSymbol}` : '';
    return `${formatUsd(action.amountUsd)}${suffix}`;
  }
  return formatUsd(action.sizeUsd);
}

export function FlashPositionConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: FlashPositionConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const started = hasTransactionStarted(action.status);
  const reduceMotion = useReducedMotion();
  const statusLabel = formatPrivateSendStatus(action.status);
  const handleConfirm = useCallback(() => {
    onConfirm(action);
  }, [action, onConfirm]);

  const handleCancel = useCallback(() => {
    onCancel(action);
  }, [action, onCancel]);

  const expiresInMs = action.expiresAt == null ? null : Math.max(0, action.expiresAt - Date.now());
  const isExpiringSoon = expiresInMs != null && expiresInMs < 15000;
  const isExpired = expiresInMs != null && expiresInMs <= 0;

  const warnings = useMemo(() => {
    const next = [...(action.warnings ?? [])];
    if (isExpired) {
      next.push('Quote expired. Ask Yuga to prepare a fresh transaction.');
    } else if (isExpiringSoon) {
      next.push('Quote expires soon. Confirm quickly.');
    }
    if (action.tradeType === 'limit' && action.limitPrice != null) {
      next.push('Limit order may not fill immediately.');
    }
    return Array.from(new Set(next));
  }, [action.limitPrice, action.tradeType, action.warnings, isExpired, isExpiringSoon]);

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            {action.actionLabel}
          </Text>
          {!started && statusLabel != null ? (
            <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
              {statusLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Market" value={action.marketSymbol} />
        <ConfirmationRow
          label="Side"
          value={getSideLabel(action.side)}
          valueColor={getSideColor(action.side)}
        />

        {action.positionKey != null ? (
          <ConfirmationRow
            label={action.operation === 'reverse_position' ? 'Reverse' : 'Position'}
            value={shortenWalletAddress(action.positionKey, 5)}
            mono
          />
        ) : null}

        {action.orderId != null ? (
          <ConfirmationRow label="Order" value={shortenWalletAddress(action.orderId, 5)} mono />
        ) : null}

        {action.operation === 'open_position' ? (
          <>
            <ConfirmationRow label="Leverage" value={formatLeverage(action.leverage)} />
            <ConfirmationRow label="Collateral" value={formatUsd(action.collateralUsd)} />
            <ConfirmationRow label="Position size" value={formatUsd(action.sizeUsd)} />
            <ConfirmationRow label="Entry price" value={formatPrice(action.entryPrice)} />
            <ConfirmationRow
              label="Liquidation"
              value={formatPrice(action.liquidationPrice)}
              valueColor={colors.semantic.warning}
            />
            <ConfirmationRow label="Entry fee" value={formatUsd(action.entryFeeUsd)} />
            <ConfirmationRow label="Input" value={action.inputTokenSymbol} />
            {action.economicIntent?.operation === 'open_position' ? (
              <>
                <ConfirmationRow
                  label="Exact collateral"
                  value={formatEncodedAmount(action.economicIntent.collateral)}
                />
                <ConfirmationRow
                  label="Exact position"
                  value={formatEncodedAmount(action.economicIntent.size)}
                />
                {action.economicIntent.executionPriceLimit != null ? (
                  <ConfirmationRow
                    label="Execution limit"
                    value={formatPrice(action.economicIntent.executionPriceLimit)}
                  />
                ) : null}
              </>
            ) : null}
            {action.limitPrice != null ? (
              <ConfirmationRow label="Limit" value={formatPrice(action.limitPrice)} />
            ) : null}
          </>
        ) : null}

        {action.operation === 'close_position' ? (
          <>
            <ConfirmationRow
              label="Close size"
              value={formatUsd(action.amountUsd ?? action.sizeUsd)}
            />
            <ConfirmationRow label="Exit price" value={formatPrice(action.exitPrice)} />
            <ConfirmationRow label="Fees" value={formatUsd(action.feesUsd ?? 0)} />
            <ConfirmationRow
              label="P&L"
              value={formatSignedUsd(action.realizedPnlUsd)}
              valueColor={
                (action.realizedPnlUsd ?? 0) >= 0 ? colors.semantic.receive : colors.semantic.error
              }
            />
            {action.economicIntent?.operation === 'close_position' ? (
              <>
                <ConfirmationRow
                  label="Exact close"
                  value={
                    action.economicIntent.size == null
                      ? 'Entire position'
                      : formatEncodedAmount(action.economicIntent.size)
                  }
                />
                <ConfirmationRow
                  label="Settlement"
                  value={action.economicIntent.outputTokenSymbol}
                />
                <ConfirmationRow
                  label="Execution limit"
                  value={formatPrice(action.economicIntent.executionPriceLimit)}
                />
              </>
            ) : null}
          </>
        ) : null}

        {action.operation === 'add_collateral' || action.operation === 'remove_collateral' ? (
          <>
            <ConfirmationRow label="Amount" value={amountLabel(action)} />
            <ConfirmationRow label="Collateral after" value={formatUsd(action.collateralUsd)} />
            <ConfirmationRow
              label="New leverage"
              value={formatLeverage(action.newLeverage ?? action.leverage)}
            />
            <ConfirmationRow
              label="New liquidation"
              value={formatPrice(action.newLiquidationPrice ?? action.liquidationPrice)}
              valueColor={colors.semantic.warning}
            />
            {action.economicIntent?.operation === 'add_collateral' ? (
              <ConfirmationRow
                label="Exact deposit"
                value={formatEncodedAmount(action.economicIntent.amount)}
              />
            ) : null}
            {action.economicIntent?.operation === 'remove_collateral' ? (
              <>
                <ConfirmationRow
                  label="Exact removal"
                  value={`$${formatAtomicAmount(action.economicIntent.usdAmountRaw, 6, 6)}`}
                />
                <ConfirmationRow
                  label="Settlement"
                  value={action.economicIntent.outputTokenSymbol}
                />
              </>
            ) : null}
          </>
        ) : null}

        {action.operation === 'place_trigger_order' || action.operation === 'edit_trigger_order' ? (
          <>
            {action.triggerOrders != null && action.triggerOrders.length > 0 ? (
              <ConfirmationRow label="Trigger" value={formatTriggerOrders(action.triggerOrders)} />
            ) : null}
            {action.amountUsd != null ? (
              <ConfirmationRow label="Size" value={formatUsd(action.amountUsd)} />
            ) : null}
            {action.economicIntent?.operation === 'place_trigger_order' ||
            action.economicIntent?.operation === 'edit_trigger_order' ? (
              <>
                <ConfirmationRow
                  label="Exact size"
                  value={formatEncodedAmount(action.economicIntent.size)}
                />
                <ConfirmationRow
                  label="Settlement"
                  value={action.economicIntent.receiveTokenSymbol}
                />
              </>
            ) : null}
          </>
        ) : null}

        {action.operation === 'cancel_trigger_order' ? (
          <ConfirmationRow label="Action" value="Cancel one trigger order" />
        ) : null}

        {action.operation === 'cancel_all_trigger_orders' ? (
          <ConfirmationRow label="Action" value="Cancel all trigger orders" />
        ) : null}

        {action.operation === 'reverse_position' ? (
          <>
            <ConfirmationRow label="New side" value={getSideLabel(action.side)} />
            <ConfirmationRow label="Size" value={formatUsd(action.sizeUsd)} />
            <ConfirmationRow label="Collateral" value={formatUsd(action.collateralUsd)} />
            <ConfirmationRow label="Leverage" value={formatLeverage(action.leverage)} />
            {action.economicIntent?.operation === 'reverse_position' ? (
              <>
                <ConfirmationRow
                  label="Exact collateral"
                  value={formatEncodedAmount(action.economicIntent.collateral)}
                />
                <ConfirmationRow
                  label="Exact position"
                  value={formatEncodedAmount(action.economicIntent.size)}
                />
                <ConfirmationRow
                  label="Settlement"
                  value={action.economicIntent.settlementTokenSymbol}
                />
                <ConfirmationRow
                  label="Close limit"
                  value={formatPrice(action.economicIntent.closeExecutionPriceLimit)}
                />
                <ConfirmationRow
                  label="Open limit"
                  value={formatPrice(action.economicIntent.openExecutionPriceLimit)}
                />
              </>
            ) : null}
          </>
        ) : null}

        {action.requestedTriggerOrders != null && action.requestedTriggerOrders.length > 0 ? (
          <ConfirmationRow
            label="After open"
            value={formatTriggerOrders(action.requestedTriggerOrders)}
          />
        ) : null}

        {action.operation === 'open_position' &&
        action.triggerOrders != null &&
        action.triggerOrders.length > 0 ? (
          <ConfirmationRow
            label="Bundled TP/SL"
            value={formatTriggerOrders(action.triggerOrders)}
          />
        ) : null}

        <ConfirmationRow label="Network" value="Solana Mainnet" />
      </View>

      {!started && warnings.length > 0 ? (
        <View style={styles.confirmationWarnings}>
          {warnings.map((warning) => (
            <Text key={warning} variant="small" color={colors.semantic.warning}>
              {warning}
            </Text>
          ))}
        </View>
      ) : null}

      {started ? (
        <TransactionTimeline
          status={action.status}
          noun="trade"
          signature={action.signature ?? null}
          errorMessage={action.errorMessage}
          resultContent={
            action.signature != null ? (
              <View style={styles.confirmationRows}>
                <TransactionHashLinkRow
                  signature={action.signature}
                  network={action.network}
                  accessibilityLabel="View Flash Trade transaction on Solscan"
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
            accessibilityLabel="Cancel Flash Trade action"
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              isExpired && styles.actionButtonDisabled,
              pressed && !isExpired && styles.actionButtonPressed,
            ]}
            onPress={handleConfirm}
            disabled={isExpired}
            accessibilityRole="button"
            accessibilityLabel={
              isExpired ? 'Flash Trade quote expired' : 'Confirm Flash Trade action'
            }
            accessibilityState={{ disabled: isExpired }}
          >
            <Text variant="buttonSmall" color={colors.text.onAccent}>
              {isExpired ? 'Expired' : 'Confirm'}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
