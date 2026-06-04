/**
 * Full-screen payroll row review. Lets the user inspect and edit staged rows
 * before confirmation, then marks routes dirty so the chat card refreshes
 * readiness with the edited recipients, amounts, and tokens.
 *
 * Uses FlashList so a 5,000-row run stays smooth.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import {
  decimalInputToAtomicAmount,
  formatAtomicAmount,
  sanitizeDecimalInput,
} from '@/lib/policy/token-amounts';
import { getStablecoinSymbolForMint } from '@/lib/policy/stablecoin-policy';
import { payrollRowStatusCopy } from '@/lib/payroll/payroll-copy';
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { usePayrollStore } from '@/store/payrollStore';
import { TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';

import { payrollStyles as styles } from './styles';
import { reviewStyles } from './review-styles';

import { isPayrollRowSettled, type PayrollRow, type PayrollRun } from '@/lib/payroll/payroll-types';
import type { OffpayNetwork, WalletBalanceResponse } from '@/types/offpay-api';

interface PayrollReviewScreenProps {
  runId: string | null;
}

interface ReviewTokenOption {
  mint: string;
  symbol: string;
  displaySymbol: string;
  decimals: number;
  name: string | null;
  balance: string | null;
  verified: boolean;
}

type TokenPickerTarget = { type: 'all' } | { type: 'row'; rowId: string };

interface RowEditPatch {
  recipient?: string;
  amountDisplay?: string;
  token?: ReviewTokenOption;
}

export function PayrollReviewScreen({ runId }: PayrollReviewScreenProps): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tokenPickerTarget, setTokenPickerTarget] = useState<TokenPickerTarget | null>(null);

  const run = usePayrollStore((state) => (runId != null ? (state.runs[runId] ?? null) : null));
  const rows = usePayrollStore((state) => (runId != null ? state.rowsByRun[runId] : undefined));
  const replaceRows = usePayrollStore((state) => state.replaceRows);
  const setRunStatus = usePayrollStore((state) => state.setRunStatus);
  const setRunToken = usePayrollStore((state) => state.setRunToken);
  const setRowSkipped = usePayrollStore((state) => state.setRowSkipped);
  const balanceQuery = useOffpayWalletBalance(run?.walletAddress ?? null, { enabled: run != null });

  const tokenOptions = useMemo(
    () => buildReviewTokenOptions(balanceQuery.data, run, rows ?? []),
    [balanceQuery.data, rows, run],
  );
  const canEdit = run != null && isEditableRun(run);
  const canAddRow = canEdit && run != null && resolveDefaultNewRowToken(run, tokenOptions) != null;

  const totals = useMemo(() => {
    const list = rows ?? [];
    let readyCount = 0;
    let skippedCount = 0;
    let invalidCount = 0;
    const totalsByMint = new Map<
      string,
      { symbol: string; decimals: number; totalAtomic: bigint }
    >();

    for (const row of list) {
      if (row.status === 'ready') {
        readyCount += 1;
        if (/^\d+$/.test(row.amountAtomic)) {
          const existing = totalsByMint.get(row.tokenMint);
          const displaySymbol = resolveRowTokenDisplaySymbol(row, tokenOptions);
          if (existing == null) {
            totalsByMint.set(row.tokenMint, {
              symbol: displaySymbol,
              decimals: row.tokenDecimals,
              totalAtomic: BigInt(row.amountAtomic),
            });
          } else {
            existing.totalAtomic += BigInt(row.amountAtomic);
          }
        }
      } else if (row.status === 'skipped') {
        skippedCount += 1;
      } else if (row.status === 'invalid') {
        invalidCount += 1;
      }
    }

    const totalLabel =
      [...totalsByMint.values()]
        .map(
          (entry) =>
            `${formatAtomicAmount(entry.totalAtomic.toString(), entry.decimals)} ${entry.symbol}`,
        )
        .join(' + ') || `0 ${run?.tokenSymbol ?? ''}`.trim();

    return { readyCount, skippedCount, invalidCount, totalLabel };
  }, [rows, run?.tokenSymbol, tokenOptions]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(TAB_ROUTE_HREFS.chat);
  }, [router]);

  const handleCancel = useCallback(() => {
    if (runId == null || run == null || !isEditableRun(run)) return;
    setRunStatus(runId, 'cancelled');
    router.replace(TAB_ROUTE_HREFS.chat);
  }, [router, run, runId, setRunStatus]);

  const persistEditedRows = useCallback(
    (nextRows: PayrollRow[]) => {
      if (runId == null || run == null) return;
      replaceRows(runId, nextRows);
      setRunToken(runId, resolveRunToken(nextRows, run));
    },
    [replaceRows, run, runId, setRunToken],
  );

  const commitRowPatch = useCallback(
    (row: PayrollRow, patch: RowEditPatch) => {
      if (!canEdit || run == null || rows == null || !isEditableRow(row)) return;
      const nextRows = rows.map((candidate) => {
        if (candidate.id !== row.id) return candidate;
        return applyPatchToRow(candidate, patch);
      });
      persistEditedRows(revalidateEditableRows(run, nextRows));
    },
    [canEdit, persistEditedRows, rows, run],
  );

  const applyTokenToAll = useCallback(
    (token: ReviewTokenOption) => {
      if (!canEdit || run == null || rows == null) return;
      const nextRows = rows.map((row) =>
        isEditableRow(row) ? applyPatchToRow(row, { token }) : row,
      );
      persistEditedRows(revalidateEditableRows(run, nextRows));
    },
    [canEdit, persistEditedRows, rows, run],
  );

  const handleSelectToken = useCallback(
    (token: ReviewTokenOption) => {
      if (tokenPickerTarget == null) return;
      if (tokenPickerTarget.type === 'all') {
        applyTokenToAll(token);
      } else {
        const row = rows?.find((candidate) => candidate.id === tokenPickerTarget.rowId);
        if (row != null) commitRowPatch(row, { token });
      }
      setTokenPickerTarget(null);
    },
    [applyTokenToAll, commitRowPatch, rows, tokenPickerTarget],
  );

  const addRow = useCallback(() => {
    if (!canEdit || run == null || rows == null) return;
    const token = resolveDefaultNewRowToken(run, tokenOptions);
    if (token == null) return;
    const nextRows = [...rows, buildManualPayrollRow(run, rows, token)];
    persistEditedRows(revalidateEditableRows(run, nextRows));
  }, [canEdit, persistEditedRows, rows, run, tokenOptions]);

  const deleteRow = useCallback(
    (row: PayrollRow) => {
      if (!canEdit || run == null || rows == null || !isEditableRow(row)) return;
      const nextRows = rows.filter((candidate) => candidate.id !== row.id);
      persistEditedRows(revalidateEditableRows(run, nextRows));
    },
    [canEdit, persistEditedRows, rows, run],
  );

  const toggleSkip = useCallback(
    (row: PayrollRow) => {
      if (runId == null) return;
      if (row.status === 'ready') setRowSkipped(runId, row.id, true);
      else if (row.status === 'skipped') setRowSkipped(runId, row.id, false);
    },
    [runId, setRowSkipped],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<PayrollRow>) => (
      <PayrollReviewRow
        row={item}
        rowNumber={index + 1}
        canEdit={canEdit}
        tokenOptions={tokenOptions}
        onCommitPatch={commitRowPatch}
        onToggleSkip={toggleSkip}
        onOpenTokenPicker={(row) => setTokenPickerTarget({ type: 'row', rowId: row.id })}
        onDeleteRow={deleteRow}
      />
    ),
    [canEdit, commitRowPatch, deleteRow, toggleSkip, tokenOptions],
  );
  const keyExtractor = useCallback((item: PayrollRow) => item.id, []);
  const selectedPickerMint =
    tokenPickerTarget?.type === 'row'
      ? (rows?.find((row) => row.id === tokenPickerTarget.rowId)?.tokenMint ?? null)
      : (run?.tokenMint ?? null);
  const runTokenLabel =
    run?.tokenMint == null
      ? 'Mixed tokens'
      : (tokenOptions.find((token) => token.mint === run.tokenMint)?.displaySymbol ??
        resolveTokenDisplaySymbol(run.tokenSymbol ?? '', null, run.tokenMint, run.network));

  return (
    <View style={[reviewStyles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={reviewStyles.header}>
        <View style={reviewStyles.headerSide}>
          <Pressable
            onPress={handleBack}
            style={reviewStyles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.text.primary} />
          </Pressable>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          Review rows
        </Text>
        <View style={[reviewStyles.headerSide, reviewStyles.headerSideRight]}>
          {canEdit ? (
            <Pressable
              onPress={handleCancel}
              style={reviewStyles.headerCancelButton}
              accessibilityRole="button"
              accessibilityLabel="Cancel payroll"
              hitSlop={8}
            >
              <Text style={reviewStyles.headerCancelText}>Cancel</Text>
            </Pressable>
          ) : (
            <View style={reviewStyles.headerSpacer} />
          )}
        </View>
      </View>

      {run == null || rows == null ? (
        <View style={reviewStyles.emptyState}>
          <Text style={styles.claimNote}>This payroll run is no longer available.</Text>
        </View>
      ) : (
        <>
          <View style={reviewStyles.totalsBar}>
            <Text style={styles.statValue}>{totals.totalLabel}</Text>
            <Text style={styles.sourceName}>
              {totals.readyCount} to pay
              {totals.skippedCount > 0 ? ` · ${totals.skippedCount} skipped` : ''}
              {totals.invalidCount > 0 ? ` · ${totals.invalidCount} blocked` : ''}
            </Text>
          </View>

          {canEdit && tokenOptions.length > 0 ? (
            <View style={reviewStyles.tokenPanel}>
              <View style={reviewStyles.reviewActionsRow}>
                <View style={reviewStyles.tokenSelectorBlock}>
                  <Text style={styles.statLabel}>Pay all with</Text>
                  <TokenSelectButton
                    label={runTokenLabel}
                    detail="All editable rows"
                    onPress={() => setTokenPickerTarget({ type: 'all' })}
                  />
                </View>
                {canAddRow ? (
                  <Pressable
                    onPress={addRow}
                    style={reviewStyles.addRowButton}
                    accessibilityRole="button"
                    accessibilityLabel="Add payroll row"
                    hitSlop={8}
                  >
                    <Ionicons name="add" size={layout.iconSizeInline} color={colors.text.primary} />
                    <Text style={reviewStyles.addRowButtonText}>Add row</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          <FlashList<PayrollRow>
            data={rows}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            drawDistance={400}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          />
          <PayrollTokenPickerModal
            visible={tokenPickerTarget != null}
            title={tokenPickerTarget?.type === 'all' ? 'Pay all with' : 'Pay row with'}
            tokens={tokenOptions}
            selectedMint={selectedPickerMint}
            onClose={() => setTokenPickerTarget(null)}
            onSelect={handleSelectToken}
          />
        </>
      )}
    </View>
  );
}

function PayrollReviewRow({
  row,
  rowNumber,
  canEdit,
  tokenOptions,
  onCommitPatch,
  onToggleSkip,
  onOpenTokenPicker,
  onDeleteRow,
}: {
  row: PayrollRow;
  rowNumber: number;
  canEdit: boolean;
  tokenOptions: readonly ReviewTokenOption[];
  onCommitPatch: (row: PayrollRow, patch: RowEditPatch) => void;
  onToggleSkip: (row: PayrollRow) => void;
  onOpenTokenPicker: (row: PayrollRow) => void;
  onDeleteRow: (row: PayrollRow) => void;
}): React.JSX.Element {
  const canToggle = row.status === 'ready' || row.status === 'skipped';
  const canEditRow = canEdit && isEditableRow(row);
  const isSkipped = row.status === 'skipped';
  const tokenLabel = resolveRowTokenDisplaySymbol(row, tokenOptions);

  return (
    <View
      style={[styles.rowItem, reviewStyles.editableRowItem, isSkipped && reviewStyles.rowSkipped]}
    >
      <View style={reviewStyles.rowMain}>
        <View style={reviewStyles.rowTitleLine}>
          <View style={reviewStyles.rowNumberBadge}>
            <Text style={reviewStyles.rowNumberText}>{rowNumber}</Text>
          </View>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {row.label ?? shortenWalletAddress(row.recipient)}
          </Text>
        </View>
        {canEditRow ? (
          <TextInput
            key={`${row.id}:recipient:${row.updatedAt}`}
            defaultValue={row.recipient}
            onEndEditing={(event) => {
              const recipient = event.nativeEvent.text.trim();
              if (recipient !== row.recipient) onCommitPatch(row, { recipient });
            }}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={reviewStyles.rowInput}
            placeholder="Recipient wallet"
            placeholderTextColor={colors.text.tertiary}
          />
        ) : (
          <Text style={styles.rowRecipient} numberOfLines={1}>
            {shortenWalletAddress(row.recipient)}
          </Text>
        )}
        {row.validationError != null ? (
          <Text style={styles.rowError} numberOfLines={3}>
            {row.validationError}
          </Text>
        ) : null}
      </View>

      <View style={reviewStyles.rowRight}>
        {canEditRow ? (
          <View style={reviewStyles.amountInputWrap}>
            <TextInput
              key={`${row.id}:amount:${row.updatedAt}`}
              defaultValue={row.amountDisplay}
              onEndEditing={(event) => {
                const amountDisplay = event.nativeEvent.text.trim();
                if (amountDisplay !== row.amountDisplay) onCommitPatch(row, { amountDisplay });
              }}
              keyboardType="decimal-pad"
              style={reviewStyles.amountInput}
              placeholder="0"
              placeholderTextColor={colors.text.tertiary}
            />
            <Text style={reviewStyles.amountSymbol}>{tokenLabel}</Text>
          </View>
        ) : (
          <Text style={styles.rowAmount}>
            {row.amountDisplay} {tokenLabel}
          </Text>
        )}
        <Text style={styles.rowStatus}>{payrollRowStatusCopy(row.status)}</Text>
        {canToggle ? (
          <View style={reviewStyles.rowActionStack}>
            <Pressable
              onPress={() => onToggleSkip(row)}
              style={reviewStyles.skipButton}
              accessibilityRole="button"
              accessibilityLabel={isSkipped ? 'Restore row' : 'Skip row'}
              hitSlop={8}
            >
              <Text style={reviewStyles.skipButtonText}>{isSkipped ? 'Restore' : 'Skip'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {canEditRow ? (
        <View style={reviewStyles.rowBottomActions}>
          <TokenSelectButton
            label={tokenLabel}
            compact
            disabled={tokenOptions.length === 0}
            onPress={() => onOpenTokenPicker(row)}
          />
          <Pressable
            onPress={() => onDeleteRow(row)}
            style={reviewStyles.deleteRowButton}
            accessibilityRole="button"
            accessibilityLabel="Delete payroll row"
            hitSlop={8}
          >
            <Ionicons
              name="trash-outline"
              size={layout.iconSizeInline - 2}
              color={colors.semantic.error}
            />
            <Text style={reviewStyles.deleteRowButtonText}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function TokenSelectButton({
  label,
  detail,
  compact = false,
  disabled = false,
  onPress,
}: {
  label: string;
  detail?: string | null;
  compact?: boolean;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        reviewStyles.tokenSelectButton,
        compact && reviewStyles.tokenSelectButtonCompact,
        disabled && reviewStyles.tokenSelectButtonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Select token ${label}`}
    >
      <View style={reviewStyles.tokenSelectTextBlock}>
        <Text style={reviewStyles.tokenSelectText} numberOfLines={1}>
          {label}
        </Text>
        {detail != null && detail.trim().length > 0 ? (
          <Text style={reviewStyles.tokenSelectDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name="chevron-down"
        size={layout.iconSizeInline - 2}
        color={colors.text.secondary}
      />
    </Pressable>
  );
}

function PayrollTokenPickerModal({
  visible,
  title,
  tokens,
  selectedMint,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  tokens: readonly ReviewTokenOption[];
  selectedMint: string | null;
  onClose: () => void;
  onSelect: (token: ReviewTokenOption) => void;
}): React.JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={reviewStyles.tokenPickerOverlay}>
        <Pressable
          style={reviewStyles.tokenPickerBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close token selector"
        />
        <View style={reviewStyles.tokenPickerSheet}>
          <View style={reviewStyles.tokenPickerHeader}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={onClose}
              style={reviewStyles.tokenPickerCloseButton}
              accessibilityRole="button"
              accessibilityLabel="Close token selector"
              hitSlop={8}
            >
              <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
            </Pressable>
          </View>
          <FlatList
            data={[...tokens]}
            keyExtractor={(token) => token.mint}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={reviewStyles.tokenPickerList}
            renderItem={({ item: token }) => {
              const selected = selectedMint === token.mint;
              return (
                <Pressable
                  onPress={() => onSelect(token)}
                  style={({ pressed }) => [
                    reviewStyles.tokenPickerRow,
                    selected && reviewStyles.tokenPickerRowSelected,
                    pressed && reviewStyles.tokenPickerRowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${token.displaySymbol}`}
                >
                  <View style={reviewStyles.tokenPickerRowText}>
                    <View style={reviewStyles.tokenPickerSymbolRow}>
                      <Text style={reviewStyles.tokenPickerSymbol} numberOfLines={1}>
                        {token.displaySymbol}
                      </Text>
                      {token.verified ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={layout.iconSizeInline - 2}
                          color={colors.brand.glossAccent}
                        />
                      ) : null}
                    </View>
                    <Text style={reviewStyles.tokenPickerName} numberOfLines={1}>
                      {token.name ?? token.displaySymbol}
                    </Text>
                  </View>
                  <View style={reviewStyles.tokenPickerRowRight}>
                    {token.balance != null ? (
                      <Text style={reviewStyles.tokenPickerBalance} numberOfLines={1}>
                        {token.balance}
                      </Text>
                    ) : null}
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={layout.iconSizeInline}
                        color={colors.text.primary}
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={reviewStyles.tokenPickerEmpty}>
                <Text style={styles.claimNote}>No portfolio tokens are available.</Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

function buildReviewTokenOptions(
  balance: WalletBalanceResponse | null | undefined,
  run: PayrollRun | null,
  rows: readonly PayrollRow[],
): ReviewTokenOption[] {
  const byMint = new Map<string, ReviewTokenOption>();
  if (balance != null) {
    for (const token of balance.tokens) {
      if (token.spam || token.mint.trim().length === 0) continue;
      const symbol = token.symbol.trim();
      const name = token.name.trim().length > 0 ? token.name : null;
      byMint.set(token.mint, {
        mint: token.mint,
        symbol: symbol.length > 0 ? symbol : 'TOKEN',
        displaySymbol: resolveTokenDisplaySymbol(symbol, name, token.mint, balance.network),
        decimals: typeof token.decimals === 'number' ? token.decimals : 6,
        name,
        balance: token.balance?.trim().length > 0 ? token.balance : null,
        verified: token.verified,
      });
    }
  }
  if (run?.tokenMint != null && run.tokenSymbol != null && run.tokenDecimals != null) {
    addTokenFallback(
      byMint,
      {
        mint: run.tokenMint,
        symbol: run.tokenSymbol,
        decimals: run.tokenDecimals,
      },
      run.network,
    );
  }
  for (const row of rows) {
    addTokenFallback(
      byMint,
      {
        mint: row.tokenMint,
        symbol: row.tokenSymbol,
        decimals: row.tokenDecimals,
      },
      run?.network ?? balance?.network ?? null,
    );
  }
  return [...byMint.values()].sort(compareReviewTokenOptions);
}

function addTokenFallback(
  byMint: Map<string, ReviewTokenOption>,
  token: { mint: string; symbol: string; decimals: number },
  network: OffpayNetwork | null,
): void {
  if (byMint.has(token.mint)) return;
  const known = resolveKnownTokenDisplay(network, token.mint);
  byMint.set(token.mint, {
    ...token,
    displaySymbol: resolveTokenDisplaySymbol(
      token.symbol,
      known?.name ?? null,
      token.mint,
      network,
    ),
    name: known?.name ?? null,
    balance: null,
    verified: false,
  });
}

function parseTokenBalance(token: ReviewTokenOption): number {
  if (token.balance == null) return 0;
  const parsed = Number.parseFloat(token.balance.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareReviewTokenOptions(left: ReviewTokenOption, right: ReviewTokenOption): number {
  const leftBalance = parseTokenBalance(left);
  const rightBalance = parseTokenBalance(right);
  const leftHasBalance = leftBalance > 0;
  const rightHasBalance = rightBalance > 0;

  if (leftHasBalance !== rightHasBalance) return leftHasBalance ? -1 : 1;
  if (leftHasBalance && rightHasBalance && leftBalance !== rightBalance) {
    return rightBalance - leftBalance;
  }
  if (left.verified !== right.verified) return left.verified ? -1 : 1;
  return left.displaySymbol.localeCompare(right.displaySymbol, undefined, { sensitivity: 'base' });
}

function resolveRowTokenDisplaySymbol(
  row: PayrollRow,
  tokenOptions: readonly ReviewTokenOption[],
): string {
  return (
    tokenOptions.find((token) => token.mint === row.tokenMint)?.displaySymbol ??
    resolveTokenDisplaySymbol(row.tokenSymbol, null, row.tokenMint)
  );
}

function resolveTokenDisplaySymbol(
  symbol: string,
  name: string | null,
  mint: string,
  network?: OffpayNetwork | null,
): string {
  const trimmedSymbol = symbol.trim();
  if (trimmedSymbol.length > 0 && !isContractLikeTokenText(trimmedSymbol, mint)) {
    return trimmedSymbol;
  }

  const known = resolveKnownTokenDisplay(network ?? null, mint);
  if (known != null) return known.symbol;

  const trimmedName = name?.trim() ?? '';
  if (trimmedName.length > 0 && !isContractLikeTokenText(trimmedName, mint)) {
    return trimmedName;
  }

  return 'Token';
}

function isContractLikeTokenText(value: string, mint: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === mint || trimmed.includes('...')) return true;
  if (isValidSolanaAddress(trimmed)) return true;
  return trimmed.length > 16 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

function resolveKnownTokenDisplay(
  network: OffpayNetwork | null,
  mint: string,
): { symbol: string; name: string } | null {
  if (network == null) return null;
  const umbra = getUmbraTokenByMint(network, mint);
  if (umbra != null) return { symbol: umbra.symbol, name: umbra.name };
  const stablecoin = getStablecoinSymbolForMint(network, mint);
  if (stablecoin == null) return null;
  return { symbol: stablecoin, name: stablecoin === 'USDC' ? 'USD Coin' : 'Tether USD' };
}

function resolveDefaultNewRowToken(
  run: PayrollRun,
  tokenOptions: readonly ReviewTokenOption[],
): ReviewTokenOption | null {
  if (run.tokenMint != null) {
    const runToken = tokenOptions.find((token) => token.mint === run.tokenMint);
    if (runToken != null) return runToken;
  }
  if (tokenOptions.length > 0) return tokenOptions[0];
  if (run.tokenMint == null || run.tokenSymbol == null || run.tokenDecimals == null) return null;
  return {
    mint: run.tokenMint,
    symbol: run.tokenSymbol,
    displaySymbol: resolveTokenDisplaySymbol(run.tokenSymbol, null, run.tokenMint, run.network),
    decimals: run.tokenDecimals,
    name: null,
    balance: null,
    verified: false,
  };
}

function buildManualPayrollRow(
  run: PayrollRun,
  existingRows: readonly PayrollRow[],
  token: ReviewTokenOption,
): PayrollRow {
  const now = Date.now();
  const sourceRow = existingRows.reduce((max, row) => Math.max(max, row.sourceRow), 1) + 1;
  const id = `${run.id}-row-manual-${now}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    id,
    sourceRow,
    label: null,
    recipient: '',
    tokenMint: token.mint,
    tokenSymbol: token.displaySymbol,
    tokenDecimals: token.decimals,
    amountAtomic: '0',
    amountDisplay: '',
    route: null,
    status: 'invalid',
    requiresRecipientClaim: false,
    validationError: 'Recipient is not a valid Solana wallet address.',
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: buildIdempotencyKey(run.id, '', '0', token.mint),
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function isEditableRun(run: PayrollRun): boolean {
  return run.status === 'draft' || run.status === 'ready';
}

function isEditableRow(row: PayrollRow): boolean {
  return (
    !isPayrollRowSettled(row.status) &&
    row.status !== 'sending' &&
    row.signature == null &&
    row.txId == null &&
    row.initSignature == null
  );
}

function applyPatchToRow(row: PayrollRow, patch: RowEditPatch): PayrollRow {
  const token = patch.token;
  const decimals = token?.decimals ?? row.tokenDecimals;
  const amountDisplay =
    patch.amountDisplay ??
    (token == null ? row.amountDisplay : sanitizeDecimalInput(row.amountDisplay, decimals));

  return {
    ...row,
    recipient: patch.recipient ?? row.recipient,
    tokenMint: token?.mint ?? row.tokenMint,
    tokenSymbol: token?.displaySymbol ?? row.tokenSymbol,
    tokenDecimals: decimals,
    amountDisplay,
    route: null,
    requiresRecipientClaim: false,
    updatedAt: Date.now(),
  };
}

function revalidateEditableRows(run: PayrollRun, rows: readonly PayrollRow[]): PayrollRow[] {
  const now = Date.now();
  const seenRecipients = new Set<string>();

  return rows.map((row) => {
    if (!isEditableRow(row)) return row;

    const recipient = row.recipient.trim();
    const amountRaw = row.amountDisplay.trim();
    const display = sanitizeDecimalInput(amountRaw, row.tokenDecimals);
    const invalid = (message: string): PayrollRow => ({
      ...row,
      recipient,
      amountDisplay: amountRaw,
      amountAtomic: '0',
      route: null,
      status: 'invalid',
      requiresRecipientClaim: false,
      validationError: message,
      idempotencyKey: buildIdempotencyKey(run.id, recipient, '0', row.tokenMint),
      updatedAt: now,
    });

    if (!isValidSolanaAddress(recipient)) {
      return invalid('Recipient is not a valid Solana wallet address.');
    }
    if (recipient === run.walletAddress) {
      return invalid('Self-payment is not allowed in payroll.');
    }
    if (amountRaw.length === 0) {
      return invalid('Missing amount.');
    }
    if (
      fractionDigitCount(sanitizeDecimalInput(amountRaw, row.tokenDecimals + 2)) > row.tokenDecimals
    ) {
      return invalid(
        `Amount has more than ${row.tokenDecimals} decimal places for ${resolveTokenDisplaySymbol(
          row.tokenSymbol,
          null,
          row.tokenMint,
        )}.`,
      );
    }

    const atomic = decimalInputToAtomicAmount(display, row.tokenDecimals);
    if (atomic == null || !/^\d+$/.test(atomic) || BigInt(atomic) <= 0n) {
      return invalid('Amount must be greater than zero.');
    }

    if (row.status !== 'skipped') {
      if (seenRecipients.has(recipient)) {
        return invalid('Duplicate recipient — remove or merge this row.');
      }
      seenRecipients.add(recipient);
    }

    return {
      ...row,
      recipient,
      amountDisplay: display,
      amountAtomic: atomic,
      route: null,
      status: row.status === 'skipped' ? 'skipped' : 'ready',
      requiresRecipientClaim: false,
      validationError: null,
      idempotencyKey: buildIdempotencyKey(run.id, recipient, atomic, row.tokenMint),
      updatedAt: now,
    };
  });
}

function resolveRunToken(
  rows: readonly PayrollRow[],
  run: PayrollRun,
): { mint: string; symbol: string; decimals: number } | null {
  const readyTokens = new Map<string, { mint: string; symbol: string; decimals: number }>();
  for (const row of rows) {
    if (row.status !== 'ready') continue;
    readyTokens.set(row.tokenMint, {
      mint: row.tokenMint,
      symbol: row.tokenSymbol,
      decimals: row.tokenDecimals,
    });
  }
  if (readyTokens.size === 1) return [...readyTokens.values()][0];
  if (readyTokens.size > 1) return null;
  if (run.tokenMint == null || run.tokenSymbol == null || run.tokenDecimals == null) return null;
  return { mint: run.tokenMint, symbol: run.tokenSymbol, decimals: run.tokenDecimals };
}

function buildIdempotencyKey(
  runId: string,
  recipient: string,
  amountAtomic: string,
  mint: string,
): string {
  return `${runId}:${recipient}:${mint}:${amountAtomic}`;
}

function fractionDigitCount(amount: string): number {
  const dot = amount.indexOf('.');
  if (dot < 0) return 0;
  return amount.slice(dot + 1).replace(/[^\d]/g, '').length;
}
