import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { PrivatePaymentReceipt } from '@/store/privatePaymentStore';

interface PrivatePaymentReceiptListProps {
  receipts: PrivatePaymentReceipt[];
}

function formatReceiptTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getReceiptRouteLabel(receipt: PrivatePaymentReceipt): string {
  return receipt.route === 'umbra' ? 'Umbra' : 'MagicBlock';
}

export function PrivatePaymentReceiptList({
  receipts,
}: PrivatePaymentReceiptListProps): React.JSX.Element | null {
  if (receipts.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text variant="h3" color={colors.text.primary} style={styles.title}>
        Private receipts
      </Text>
      <View style={styles.list}>
        {receipts.map((receipt) => (
          <View key={receipt.id} style={styles.card}>
            <View
              style={[
                styles.statusIcon,
                receipt.status === 'submitted' ? styles.submittedIcon : styles.queuedIcon,
              ]}
            >
              <Ionicons
                name={receipt.status === 'submitted' ? 'checkmark' : 'time-outline'}
                size={layout.iconSizeInline}
                color={
                  receipt.status === 'submitted' ? colors.semantic.success : colors.semantic.warning
                }
              />
            </View>

            <View style={styles.content}>
              <View style={styles.headerRow}>
                <Text variant="bodyBold" color={colors.text.primary} style={styles.receiptTitle}>
                  {getReceiptRouteLabel(receipt)}{' '}
                  {receipt.status === 'submitted' ? 'submitted' : 'queued'}
                </Text>
                <Text variant="small" color={colors.text.tertiary}>
                  {formatReceiptTime(receipt.createdAt)}
                </Text>
              </View>
              <Text variant="small" color={colors.text.secondary} style={styles.message}>
                {receipt.message}
              </Text>
              <Text variant="small" color={colors.text.tertiary}>
                Amount {receipt.amount}
              </Text>
              {receipt.signature != null ? (
                <CopyableAddress address={receipt.signature} label="Copy signature" />
              ) : null}
              {receipt.txId != null ? (
                <CopyableAddress address={receipt.txId} label="Copy queued tx id" />
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  title: {
    fontFamily: fontFamily.semiBold,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.lg,
    backgroundColor: colors.surface.card,
  },
  statusIcon: {
    minWidth: layout.avatarMd,
    minHeight: layout.avatarMd,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submittedIcon: {
    backgroundColor: colors.holdingsCard.pressed,
  },
  queuedIcon: {
    backgroundColor: colors.surface.backgroundAlt,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    minWidth: 0,
  },
  receiptTitle: {
    flex: 1,
    minWidth: 0,
  },
  message: {
    lineHeight: 18,
  },
});
