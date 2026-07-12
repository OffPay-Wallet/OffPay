import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  formatRwaAssetDisplayName,
  getRwaAssetLogoUri,
} from '@/components/features/rwa/rwa-trade-utils';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { buildRwaExecutionSignatureLinks } from '@/lib/rwa/rwa-execution-signatures';
import type { AgenticRwaTradeAction } from '@/store/agenticChatStore';

import { ConfirmationCardSurface } from './ConfirmationCardSurface';
import { ConfirmationRow } from './ConfirmationRow';
import { TransactionHashLinkRow } from './TransactionHashLinkRow';
import { formatPrivateSendStatus, isFinalPrivateSendStatus } from './helpers';
import { confirmationStyles as styles } from './styles/confirmation';

interface RwaTradeConfirmationCardProps {
  action: AgenticRwaTradeAction;
  onConfirm: (action: AgenticRwaTradeAction) => void;
  onCancel: (action: AgenticRwaTradeAction) => void;
}

function formatNetwork(network: AgenticRwaTradeAction['network']): string {
  return network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet';
}

export function RwaTradeConfirmationCard({
  action,
  onConfirm,
  onCancel,
}: RwaTradeConfirmationCardProps): React.JSX.Element {
  const canAct = action.status === 'needs_confirmation';
  const submitting = action.status === 'submitting';
  const failed = action.status === 'failed';
  const showActions = !isFinalPrivateSendStatus(action.status) && !failed;
  const assetName = formatRwaAssetDisplayName(action.asset);
  const title = `${action.side === 'buy' ? 'Buy' : 'Sell'} ${assetName}`;
  const statusLabel = formatPrivateSendStatus(action.status);
  const assetMeta = [action.asset.symbol, statusLabel].filter(Boolean).join(' · ');
  const signatureLinks =
    action.signatures != null && action.signatures.length > 0
      ? buildRwaExecutionSignatureLinks({
          quoteId: action.quoteId,
          network: action.network,
          signature: action.signature ?? action.signatures[action.signatures.length - 1]!.signature,
          signatures: action.signatures,
          status: 'submitted',
          submittedAt: action.updatedAt,
          provider: action.provider,
        })
      : action.signature != null
        ? [{ label: 'Tx', signature: action.signature, network: action.network }]
        : [];

  return (
    <ConfirmationCardSurface>
      <View style={styles.confirmationHeader}>
        <View style={localStyles.assetLogo}>
          <TokenIcon
            symbol={action.asset.underlyingSymbol ?? action.asset.symbol}
            name={action.asset.name}
            logoUri={getRwaAssetLogoUri(action.asset)}
            size={40}
            recyclingKey={action.asset.mint}
          />
        </View>
        <View style={styles.confirmationTitleStack}>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={styles.confirmationTitle}
            numberOfLines={2}
            maxFontSizeMultiplier={1.15}
          >
            {title}
          </Text>
          {assetMeta.length > 0 ? (
            <Text
              variant="small"
              color={colors.text.secondary}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {assetMeta}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.confirmationRows}>
        <ConfirmationRow label="Pay" value={`${action.payAmount} ${action.paySymbol}`} />
        <ConfirmationRow
          label="Receive"
          value={`~${action.receiveAmount} ${action.receiveSymbol}`}
        />
        <ConfirmationRow label="Network" value={formatNetwork(action.network)} />
        <ConfirmationRow label="Price impact" value={`${action.priceImpactPct}%`} />
        <ConfirmationRow label="Quote fee" value={action.fee} />
        {signatureLinks.map((item) => (
          <TransactionHashLinkRow
            key={`${item.label}-${item.signature}`}
            label={item.label}
            signature={item.signature}
            network={item.network}
            accessibilityLabel="View RWA transaction on Solscan"
          />
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
            onPress={() => onCancel(action)}
            disabled={!canAct || submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel RWA trade"
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
            accessibilityLabel="Confirm RWA trade"
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

const localStyles = StyleSheet.create({
  assetLogo: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
