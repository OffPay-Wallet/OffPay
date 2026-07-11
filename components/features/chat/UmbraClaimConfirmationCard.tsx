import React from 'react';
import { Pressable, View } from 'react-native';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import type { AgenticUmbraClaimAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
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
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;
  const statusLabel = formatPrivateSendStatus(action.status);

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            Claim Umbra funds
          </Text>
          {statusLabel != null ? (
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
        {action.signature != null ? (
          <TransactionHashLinkRow
            signature={action.signature}
            network={action.network}
            accessibilityLabel="View Umbra claim transaction on Solscan"
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
            accessibilityLabel="Cancel Umbra claim"
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
            accessibilityLabel="Confirm Umbra claim"
          >
            {submitting ? (
              <LazyLoadingSpinner size={18} color={colors.brand.deepShadow} />
            ) : (
              <Text variant="buttonSmall" color={colors.text.onAccent}>
                Confirm claim
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ConfirmationCardSurface>
  );
}
