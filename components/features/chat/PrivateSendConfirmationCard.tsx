/**
 * In-bubble confirmation card. Renders the drafted Yuga transfer
 * (amount/recipient/network/route) with explicit Confirm and Cancel
 * buttons. Tx and queue ids open Solscan when tapped.
 */

import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useAppToast } from '@/components/ui/AppToast';

import type { AgenticPrivateSendAction } from '@/store/agenticChatStore';

import { ConfirmationRow } from './ConfirmationRow';
import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface PrivateSendConfirmationCardProps {
  action: AgenticPrivateSendAction;
  onConfirm: (action: AgenticPrivateSendAction) => void;
  onCancel: (action: AgenticPrivateSendAction) => void;
  onRouteChange?: (
    action: AgenticPrivateSendAction,
    route: AgenticPrivateSendAction['route'],
  ) => void;
}

const ROUTE_OPTIONS: { route: AgenticPrivateSendAction['route']; label: string }[] = [
  { route: 'normal', label: 'Normal' },
  { route: 'umbra', label: 'Umbra' },
  { route: 'magicblock', label: 'MagicBlock' },
];

function routeLabel(route: AgenticPrivateSendAction['route']): string {
  if (route === 'normal') return 'Normal';
  if (route === 'umbra') return 'Umbra';
  return 'MagicBlock';
}

export function PrivateSendConfirmationCard({
  action,
  onConfirm,
  onCancel,
  onRouteChange,
}: PrivateSendConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;
  const { showToast } = useAppToast();
  const copyHash = useCallback(
    async (value: string, label: string) => {
      await Clipboard.setStringAsync(value);
      showToast({ title: 'Copied', message: `${label} copied to clipboard.`, variant: 'success' });
    },
    [showToast],
  );

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Transfer
          </Text>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {formatPrivateSendStatus(action.status)}
          </Text>
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Amount" value={`${action.amount} ${action.tokenSymbol}`} />
        <ConfirmationRow label="To" value={shortenWalletAddress(action.recipient, 5)} mono />
        <ConfirmationRow
          label="Network"
          value={action.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}
        />
        {canAct && onRouteChange != null ? (
          <View style={styles.routeChoiceBlock}>
            <Text variant="small" color={colors.text.tertiary} style={styles.confirmationRowLabel}>
              Route
            </Text>
            <View style={styles.routeChoice}>
              {ROUTE_OPTIONS.map((option) => {
                const selected = action.route === option.route;
                return (
                  <Pressable
                    key={option.route}
                    onPress={() => onRouteChange(action, option.route)}
                    disabled={selected || submitting}
                    style={({ pressed }) => [
                      styles.routeChoiceOption,
                      selected && styles.routeChoiceOptionSelected,
                      pressed && !selected && styles.routeChoiceOptionPressed,
                      submitting && styles.actionButtonDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${option.label} route`}
                    accessibilityState={{ selected, disabled: selected || submitting }}
                  >
                    <Text
                      variant="small"
                      color={selected ? colors.text.onAccent : colors.text.secondary}
                      style={[styles.routeChoiceText, selected && styles.routeChoiceTextSelected]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <ConfirmationRow label="Route" value={routeLabel(action.route)} />
        )}
        {action.signature != null ? (
          <TransactionHashLinkRow
            signature={action.signature}
            network={action.network}
            accessibilityLabel="View transfer transaction on Solscan"
          />
        ) : null}
        {action.txId != null ? (
          <ConfirmationRow
            label="Queue"
            value={shortenWalletAddress(action.txId, 5)}
            mono
            onPress={() => {
              if (action.txId == null) return;
              void copyHash(action.txId, 'Queue id');
            }}
            accessibilityLabel="Copy queued transaction id"
          />
        ) : null}
      </View>

      {action.errorMessage != null ? (
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
            onPress={() => onCancel(action)}
            disabled={!canAct || submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel Yuga transfer"
          >
            <Text variant="buttonSmall" color={colors.text.secondary}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryActionButton,
              (!canAct || submitting) && styles.actionButtonDisabled,
              pressed && canAct && styles.actionButtonPressed,
            ]}
            onPress={() => onConfirm(action)}
            disabled={!canAct || submitting}
            accessibilityRole="button"
            accessibilityLabel="Confirm Yuga transfer"
          >
            {submitting ? (
              <LazyLoadingSpinner size={18} color={colors.brand.deepShadow} />
            ) : (
              <Text variant="buttonSmall" color={colors.text.onAccent}>
                Confirm
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
