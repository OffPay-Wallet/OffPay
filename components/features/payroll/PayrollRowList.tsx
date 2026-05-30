/**
 * Virtualized payroll row preview. Uses FlashList so a 5,000-row run stays
 * smooth — allocation is bounded by visible rows, never the full array. No
 * `.map()` over the row array in a ScrollView.
 */

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { payrollRowStatusCopy } from '@/lib/payroll/payroll-copy';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import { payrollStyles as styles } from './styles';

import type { PayrollRow, PayrollRowStatus } from '@/lib/payroll/payroll-types';

interface PayrollRowListProps {
  rows: PayrollRow[];
}

function statusColor(status: PayrollRowStatus): string {
  switch (status) {
    case 'submitted':
    case 'queued':
    case 'deposited_unclaimed':
      return colors.semantic.success;
    case 'failed':
    case 'invalid':
      return colors.semantic.error;
    case 'sending':
      return colors.semantic.info;
    default:
      return colors.text.tertiary;
  }
}

function PayrollRowItem({ row }: { row: PayrollRow }): React.JSX.Element {
  return (
    <View style={styles.rowItem}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {row.label ?? shortenWalletAddress(row.recipient)}
        </Text>
        <Text style={styles.rowRecipient} numberOfLines={1}>
          {shortenWalletAddress(row.recipient)}
        </Text>
        {row.validationError != null ? (
          <Text style={styles.rowError} numberOfLines={2}>
            {row.validationError}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.rowAmount}>
          {row.amountDisplay} {row.tokenSymbol}
        </Text>
        <Text style={[styles.rowStatus, { color: statusColor(row.status) }]}>
          {payrollRowStatusCopy(row.status)}
        </Text>
      </View>
    </View>
  );
}

export function PayrollRowList({ rows }: PayrollRowListProps): React.JSX.Element {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PayrollRow>) => <PayrollRowItem row={item} />,
    [],
  );
  const keyExtractor = useCallback((item: PayrollRow) => item.id, []);

  return (
    <FlashList<PayrollRow>
      data={rows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      drawDistance={400}
      showsVerticalScrollIndicator={false}
    />
  );
}
