/**
 * In-bubble confirmation card. Renders the drafted Yuga transfer
 * (amount/recipient/network/route) with explicit Confirm and Cancel
 * buttons. Tx and queue ids open Solscan when tapped.
 */

import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';

import {
  AnimatedSegmentedControl,
  type AnimatedSegmentedOption,
} from '@/components/ui/AnimatedSegmentedControl';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useAppToast } from '@/components/ui/AppToast';

import type { AgenticPrivateSendAction } from '@/store/agenticChatStore';

import { ConfirmationRow } from './ConfirmationRow';
import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { TransactionTimeline, hasTransactionStarted } from './TransactionTimeline';
import { formatPrivateSendStatus } from './helpers';
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

const ROUTE_OPTIONS: readonly AnimatedSegmentedOption<AgenticPrivateSendAction['route']>[] = [
  { value: 'normal', label: 'Normal', accessibilityLabel: 'Use Normal route' },
  { value: 'umbra', label: 'Umbra', accessibilityLabel: 'Use Umbra route' },
  { value: 'magicblock', label: 'MagicBlock', accessibilityLabel: 'Use MagicBlock route' },
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
  const started = hasTransactionStarted(action.status);
  const reduceMotion = useReducedMotion();
  const { showToast } = useAppToast();
  const statusLabel = formatPrivateSendStatus(action.status);
  const copyHash = useCallback(
    async (value: string, label: string) => {
      await Clipboard.setStringAsync(value);
      showToast({ title: 'Copied', message: `${label} copied to clipboard.`, variant: 'success' });
    },
    [showToast],
  );

  const resultContent =
    action.signature != null || action.txId != null ? (
      <View style={styles.confirmationRows}>
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
    ) : null;

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Transfer
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
            <AnimatedSegmentedControl
              options={ROUTE_OPTIONS}
              value={action.route}
              onChange={(route) => onRouteChange(action, route)}
            />
          </View>
        ) : (
          <ConfirmationRow label="Route" value={routeLabel(action.route)} />
        )}
      </View>

      {started ? (
        <TransactionTimeline
          status={action.status}
          noun="transfer"
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
            accessibilityLabel="Cancel Yuga transfer"
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
            accessibilityLabel="Confirm Yuga transfer"
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
