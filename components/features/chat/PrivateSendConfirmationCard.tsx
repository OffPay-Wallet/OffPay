/**
 * In-bubble confirmation card. Renders the drafted Yuga transfer
 * (amount/recipient/network/route) with explicit Confirm and Cancel
 * buttons. Tx and queue ids open Solscan when tapped.
 */

import React from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import type { AgenticPrivateSendAction } from '@/store/agenticChatStore';

import { ConfirmationRow } from './ConfirmationRow';
import { buildSolscanTxUrl, formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface PrivateSendConfirmationCardProps {
  action: AgenticPrivateSendAction;
  onConfirm: (action: AgenticPrivateSendAction) => void;
  onCancel: (action: AgenticPrivateSendAction) => void;
}

export function PrivateSendConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: PrivateSendConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;

  return (
    <View style={styles.confirmationCard}>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationIcon}>
          <Ionicons
            name={action.route === 'normal' ? 'paper-plane-outline' : 'shield-checkmark-outline'}
            size={18}
            color={colors.brand.deepShadow}
          />
        </View>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Yuga Transfer
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
        <ConfirmationRow
          label="Route"
          value={action.route === 'normal' ? 'Normal transfer' : 'MagicBlock private send'}
        />
        {action.signature != null ? (
          <ConfirmationRow
            label="Tx"
            value={shortenWalletAddress(action.signature, 5)}
            mono
            onPress={() => {
              if (action.signature == null) return;
              void Linking.openURL(buildSolscanTxUrl(action.signature, action.network));
            }}
            accessibilityLabel="Open transaction in Solscan"
          />
        ) : null}
        {action.txId != null ? (
          <ConfirmationRow
            label="Queue"
            value={shortenWalletAddress(action.txId, 5)}
            mono
            onPress={() => {
              if (action.txId == null) return;
              void Linking.openURL(buildSolscanTxUrl(action.txId, action.network));
            }}
            accessibilityLabel="Open queued transaction in Solscan"
          />
        ) : null}
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
              <ActivityIndicator size="small" color={colors.brand.whiteStream} />
            ) : (
              <Text variant="buttonSmall" color={colors.brand.whiteStream}>
                Confirm
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
