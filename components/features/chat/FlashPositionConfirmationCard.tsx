import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useAppToast } from '@/components/ui/AppToast';
import type {
  AgenticFlashPositionAction,
  AgenticFlashTriggerOrderSummary,
} from '@/store/agenticChatStore';

import { ConfirmationRow } from './ConfirmationRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface FlashPositionConfirmationCardProps {
  action: AgenticFlashPositionAction;
  onConfirm: (action: AgenticFlashPositionAction) => void;
  onCancel: (action: AgenticFlashPositionAction) => void;
}

const EXPIRY_TICK_MS = 1000;

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

function getOperationIcon(
  action: AgenticFlashPositionAction,
): keyof typeof Ionicons.glyphMap {
  if (action.operation === 'close_position') return 'log-out-outline';
  if (action.operation === 'add_collateral') return 'add-circle-outline';
  if (action.operation === 'remove_collateral') return 'remove-circle-outline';
  if (
    action.operation === 'place_trigger_order' ||
    action.operation === 'edit_trigger_order' ||
    action.operation === 'cancel_trigger_order' ||
    action.operation === 'cancel_all_trigger_orders'
  ) {
    return 'git-branch-outline';
  }
  if (action.operation === 'reverse_position') return 'swap-vertical-outline';
  return action.side === 'long' ? 'trending-up-outline' : 'trending-down-outline';
}

function formatTriggerOrder(order: AgenticFlashTriggerOrderSummary): string {
  const label = order.orderType === 'take_profit' ? 'TP' : 'SL';
  return `${label} ${formatPrice(order.triggerPrice)} / ${order.sizePercent}%`;
}

function formatTriggerOrders(orders: readonly AgenticFlashTriggerOrderSummary[]): string {
  return orders.map(formatTriggerOrder).join(' / ');
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
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;
  const { showToast } = useAppToast();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!canAct) return undefined;
    const id = setInterval(() => setNow(Date.now()), EXPIRY_TICK_MS);
    return () => clearInterval(id);
  }, [canAct]);

  const copyHash = useCallback(
    async (value: string, label: string) => {
      await Clipboard.setStringAsync(value);
      showToast({
        title: 'Copied',
        message: `${label} copied to clipboard.`,
        variant: 'success',
      });
    },
    [showToast],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(action);
  }, [action, onConfirm]);

  const handleCancel = useCallback(() => {
    onCancel(action);
  }, [action, onCancel]);

  const expiresInMs = Math.max(0, action.expiresAt - now);
  const isExpiringSoon = expiresInMs < 15000;
  const isExpired = expiresInMs <= 0;

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
    <View style={styles.confirmationCard}>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationIcon}>
          <Ionicons
            name={getOperationIcon(action)}
            size={18}
            color={getSideColor(action.side)}
          />
        </View>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            {action.actionLabel}
          </Text>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {formatPrivateSendStatus(action.status)}
          </Text>
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
            {action.limitPrice != null ? (
              <ConfirmationRow label="Limit" value={formatPrice(action.limitPrice)} />
            ) : null}
          </>
        ) : null}

        {action.operation === 'close_position' ? (
          <>
            <ConfirmationRow label="Close size" value={formatUsd(action.amountUsd ?? action.sizeUsd)} />
            <ConfirmationRow label="Exit price" value={formatPrice(action.exitPrice)} />
            <ConfirmationRow label="Fees" value={formatUsd(action.feesUsd ?? 0)} />
            <ConfirmationRow
              label="P&L"
              value={formatSignedUsd(action.realizedPnlUsd)}
              valueColor={
                (action.realizedPnlUsd ?? 0) >= 0
                  ? colors.semantic.receive
                  : colors.semantic.error
              }
            />
          </>
        ) : null}

        {action.operation === 'add_collateral' || action.operation === 'remove_collateral' ? (
          <>
            <ConfirmationRow label="Amount" value={amountLabel(action)} />
            <ConfirmationRow label="Collateral after" value={formatUsd(action.collateralUsd)} />
            <ConfirmationRow label="New leverage" value={formatLeverage(action.newLeverage ?? action.leverage)} />
            <ConfirmationRow
              label="New liquidation"
              value={formatPrice(action.newLiquidationPrice ?? action.liquidationPrice)}
              valueColor={colors.semantic.warning}
            />
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
          </>
        ) : null}

        {action.requestedTriggerOrders != null && action.requestedTriggerOrders.length > 0 ? (
          <ConfirmationRow
            label="After open"
            value={formatTriggerOrders(action.requestedTriggerOrders)}
          />
        ) : null}

        <ConfirmationRow label="Network" value="Solana Mainnet" />

        {action.signature != null ? (
          <ConfirmationRow
            label="Tx"
            value={shortenWalletAddress(action.signature, 5)}
            mono
            onPress={() => {
              if (action.signature != null) {
                void copyHash(action.signature, 'Transaction hash');
              }
            }}
            accessibilityLabel="Copy Flash Trade transaction hash"
          />
        ) : null}
      </View>

      {warnings.length > 0 ? (
        <View style={styles.confirmationWarnings}>
          {warnings.map((warning) => (
            <Text key={warning} variant="small" color={colors.semantic.warning}>
              {warning}
            </Text>
          ))}
        </View>
      ) : null}

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
            accessibilityLabel="Cancel Flash Trade action"
            accessibilityState={{ disabled: !canAct || submitting }}
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              (!canAct || submitting || isExpired) && styles.actionButtonDisabled,
              pressed && canAct && !isExpired && styles.actionButtonPressed,
            ]}
            onPress={handleConfirm}
            disabled={!canAct || submitting || isExpired}
            accessibilityRole="button"
            accessibilityLabel={isExpired ? 'Flash Trade quote expired' : 'Confirm Flash Trade action'}
            accessibilityState={{ disabled: !canAct || submitting || isExpired }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.brand.deepShadow} />
            ) : (
              <Text variant="buttonSmall" color={colors.text.onAccent}>
                {isExpired ? 'Expired' : 'Confirm'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
