import React from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import type { AgenticSwapAction } from '@/store/agenticChatStore';

import { ConfirmationRow } from './ConfirmationRow';
import { buildSolscanTxUrl, formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
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
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;

  return (
    <View style={styles.confirmationCard}>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationIcon}>
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.brand.deepShadow} />
        </View>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Yuga Swap
          </Text>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {formatPrivateSendStatus(action.status)}
          </Text>
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Pay" value={`${action.inputAmount} ${action.inputSymbol}`} />
        <ConfirmationRow label="Receive" value={`~${action.outputAmount} ${action.outputSymbol}`} />
        <ConfirmationRow
          label="Network"
          value={action.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}
        />
        <ConfirmationRow label="Route" value="Normal swap" />
        <ConfirmationRow label="Price impact" value={`${action.priceImpactPct}%`} />
        <ConfirmationRow label="Quote fee" value={action.fee} />
        {action.signature != null ? (
          <ConfirmationRow
            label="Tx"
            value={shortenWalletAddress(action.signature, 5)}
            mono
            onPress={() => {
              if (action.signature == null) return;
              void Linking.openURL(buildSolscanTxUrl(action.signature, action.network));
            }}
            accessibilityLabel="Open swap transaction in Solscan"
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
            accessibilityLabel="Cancel Yuga swap"
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
            accessibilityLabel="Confirm Yuga swap"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.brand.deepShadow} />
            ) : (
              <Text variant="buttonSmall" color={colors.text.onAccent}>
                Confirm
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
