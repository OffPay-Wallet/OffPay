/**
 * Full-screen payroll row review. Lets the user inspect every staged row and
 * skip/restore individual rows before confirming. Editing amounts/recipients
 * is intentionally NOT offered here — that would require re-running validation
 * and routing; instead the user fixes the source file and re-uploads. Skipping
 * is safe because it only flips ready <-> skipped (never settled/invalid rows).
 *
 * Uses FlashList so a 5,000-row run stays smooth.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import { payrollRowStatusCopy } from '@/lib/payroll/payroll-copy';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { usePayrollStore } from '@/store/payrollStore';

import { payrollStyles as styles } from './styles';
import { reviewStyles } from './review-styles';

import type { PayrollRow } from '@/lib/payroll/payroll-types';

interface PayrollReviewScreenProps {
  runId: string | null;
}

export function PayrollReviewScreen({ runId }: PayrollReviewScreenProps): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const run = usePayrollStore((state) => (runId != null ? state.runs[runId] ?? null : null));
  const rows = usePayrollStore((state) => (runId != null ? state.rowsByRun[runId] : undefined));
  const setRowSkipped = usePayrollStore((state) => state.setRowSkipped);

  const totals = useMemo(() => {
    const list = rows ?? [];
    let readyCount = 0;
    let skippedCount = 0;
    let invalidCount = 0;
    let totalAtomic = 0n;
    for (const row of list) {
      if (row.status === 'ready') {
        readyCount += 1;
        if (/^\d+$/.test(row.amountAtomic)) totalAtomic += BigInt(row.amountAtomic);
      } else if (row.status === 'skipped') {
        skippedCount += 1;
      } else if (row.status === 'invalid') {
        invalidCount += 1;
      }
    }
    return { readyCount, skippedCount, invalidCount, totalAtomic: totalAtomic.toString() };
  }, [rows]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const toggleSkip = useCallback(
    (row: PayrollRow) => {
      if (runId == null) return;
      if (row.status === 'ready') setRowSkipped(runId, row.id, true);
      else if (row.status === 'skipped') setRowSkipped(runId, row.id, false);
    },
    [runId, setRowSkipped],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PayrollRow>) => (
      <PayrollReviewRow row={item} onToggleSkip={toggleSkip} />
    ),
    [toggleSkip],
  );
  const keyExtractor = useCallback((item: PayrollRow) => item.id, []);

  const decimals = run?.tokenDecimals ?? 6;
  const symbol = run?.tokenSymbol ?? '';

  return (
    <View style={[reviewStyles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={reviewStyles.header}>
        <Pressable
          onPress={handleBack}
          style={reviewStyles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.brand.deepShadow} />
        </Pressable>
        <Text style={styles.title}>Review rows</Text>
        <View style={reviewStyles.backButton} />
      </View>

      {run == null || rows == null ? (
        <View style={reviewStyles.emptyState}>
          <Text style={styles.claimNote}>This payroll run is no longer available.</Text>
        </View>
      ) : (
        <>
          <View style={reviewStyles.totalsBar}>
            <Text style={styles.statValue}>
              {formatAtomicAmount(totals.totalAtomic, decimals)} {symbol}
            </Text>
            <Text style={styles.sourceName}>
              {totals.readyCount} to pay
              {totals.skippedCount > 0 ? ` · ${totals.skippedCount} skipped` : ''}
              {totals.invalidCount > 0 ? ` · ${totals.invalidCount} blocked` : ''}
            </Text>
          </View>

          <FlashList<PayrollRow>
            data={rows}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            drawDistance={400}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          />
        </>
      )}
    </View>
  );
}

function PayrollReviewRow({
  row,
  onToggleSkip,
}: {
  row: PayrollRow;
  onToggleSkip: (row: PayrollRow) => void;
}): React.JSX.Element {
  const canToggle = row.status === 'ready' || row.status === 'skipped';
  const isSkipped = row.status === 'skipped';

  return (
    <View style={[styles.rowItem, isSkipped && reviewStyles.rowSkipped]}>
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

      <View style={reviewStyles.rowRight}>
        <Text style={styles.rowAmount}>
          {row.amountDisplay} {row.tokenSymbol}
        </Text>
        <Text style={styles.rowStatus}>{payrollRowStatusCopy(row.status)}</Text>
        {canToggle ? (
          <Pressable
            onPress={() => onToggleSkip(row)}
            style={reviewStyles.skipButton}
            accessibilityRole="button"
            accessibilityLabel={isSkipped ? 'Restore row' : 'Skip row'}
            hitSlop={8}
          >
            <Text style={reviewStyles.skipButtonText}>{isSkipped ? 'Restore' : 'Skip'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
