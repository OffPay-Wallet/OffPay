import React from 'react';
import { Pressable, View } from 'react-native';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import type { AgenticUmbraVaultAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface UmbraVaultConfirmationCardProps {
  action: AgenticUmbraVaultAction;
  onConfirm: (action: AgenticUmbraVaultAction) => void;
  onCancel: (action: AgenticUmbraVaultAction) => void;
}

function getTitle(action: AgenticUmbraVaultAction): string {
  return action.operation === 'shield' ? 'Shield' : 'Withdraw';
}

function getDirection(action: AgenticUmbraVaultAction): string {
  return action.operation === 'shield'
    ? 'Public balance to Umbra vault'
    : 'Umbra vault to public balance';
}

export function UmbraVaultConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: UmbraVaultConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={styles.confirmationTitleStack}>
          <Text variant="bodyBold" color={colors.text.primary} style={styles.confirmationTitle}>
            {getTitle(action)}
          </Text>
          <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
            {formatPrivateSendStatus(action.status)}
          </Text>
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Amount" value={`${action.amount} ${action.tokenSymbol}`} />
        <ConfirmationRow label="Direction" value={getDirection(action)} />
        <ConfirmationRow
          label="Network"
          value={action.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}
        />
        {action.signature != null ? (
          <TransactionHashLinkRow
            signature={action.signature}
            network={action.network}
            accessibilityLabel="View Umbra vault transaction on Solscan"
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
            accessibilityLabel={`Cancel Umbra ${action.operation}`}
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
            accessibilityLabel={`Confirm Umbra ${action.operation}`}
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
