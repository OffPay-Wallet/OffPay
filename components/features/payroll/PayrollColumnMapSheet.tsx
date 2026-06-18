/**
 * Manual column-mapping sheet. Shown when batch-send staging parsed the file but
 * could not auto-detect the recipient/amount columns. The user assigns each
 * role to one of the parsed headers; recipient + amount are required, token
 * and label are optional. Submitting re-stages with the chosen mapping.
 */

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { useReanimatedModalProgress } from '@/components/ui/useReanimatedModalProgress';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import { payrollStyles as styles } from './styles';

import type {
  PayrollColumnMapping,
  PayrollColumnRole,
} from '@/lib/payroll/parsing/payroll-column-mapping';

interface PayrollColumnMapSheetProps {
  visible: boolean;
  busy: boolean;
  headers: string[];
  sampleRows: Record<string, string>[];
  suggestedMapping: PayrollColumnMapping;
  onClose: () => void;
  onSubmit: (mapping: PayrollColumnMapping) => void;
}

const ROLES: { role: PayrollColumnRole; label: string; required: boolean }[] = [
  { role: 'recipient', label: 'Recipient wallet', required: true },
  { role: 'amount', label: 'Amount', required: true },
  { role: 'token', label: 'Token (optional)', required: false },
  { role: 'label', label: 'Label (optional)', required: false },
];

export function PayrollColumnMapSheet({
  visible,
  busy,
  headers,
  sampleRows,
  suggestedMapping,
  onClose,
  onSubmit,
}: PayrollColumnMapSheetProps): React.JSX.Element | null {
  const [mapping, setMapping] = useState<PayrollColumnMapping>(suggestedMapping);

  // Reset local state whenever a new mapping request arrives.
  const requestKey = useMemo(() => headers.join('|'), [headers]);
  const [seenKey, setSeenKey] = useState(requestKey);
  if (seenKey !== requestKey) {
    setSeenKey(requestKey);
    setMapping(suggestedMapping);
  }

  const assign = (role: PayrollColumnRole, header: string): void => {
    setMapping((prev) => {
      const next: PayrollColumnMapping = { ...prev };
      // A header can only fill one role; clear it from any other role first.
      for (const key of Object.keys(next) as PayrollColumnRole[]) {
        if (next[key] === header) next[key] = null;
      }
      next[role] = next[role] === header ? null : header;
      return next;
    });
  };

  const canSubmit = mapping.recipient != null && mapping.amount != null && !busy;
  const { mounted, progress } = useReanimatedModalProgress(visible);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 36 }],
  }));

  const preview = (header: string): string => {
    const value = sampleRows.find((row) => row[header]?.length > 0)?.[header];
    return value != null && value.length > 0 ? value : '—';
  };

  if (!mounted) return null;

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={onClose}>
      <Animated.View style={[mapStyles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close column mapping"
        />
        <Animated.View style={[mapStyles.sheet, sheetStyle]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Map columns</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.claimNote}>
            Choose the columns for this batch. Wallet and amount are required.
          </Text>

          <ScrollView style={mapStyles.scroll} contentContainerStyle={mapStyles.scrollContent}>
            {ROLES.map(({ role, label, required }) => (
              <View key={role} style={mapStyles.roleBlock}>
                <Text style={styles.statLabel}>
                  {label}
                  {required ? ' *' : ''}
                </Text>
                <View style={mapStyles.chipRow}>
                  {headers.map((header) => {
                    const selected = mapping[role] === header;
                    return (
                      <Pressable
                        key={`${role}-${header}`}
                        onPress={() => assign(role, header)}
                        style={[mapStyles.chip, selected && mapStyles.chipSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Assign ${label} to ${header}`}
                      >
                        <Text
                          style={[mapStyles.chipText, selected && mapStyles.chipTextSelected]}
                          numberOfLines={1}
                        >
                          {header}
                        </Text>
                        <Text style={mapStyles.chipPreview} numberOfLines={1}>
                          {preview(header)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable
            style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            onPress={() => onSubmit(mapping)}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Apply column mapping"
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.primaryButtonText}>Use these columns</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const mapStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 16, 16, 0.32)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface.backgroundAlt,
    borderTopLeftRadius: spacing.xl,
    borderTopRightRadius: spacing.xl,
    borderCurve: 'continuous',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '80%',
  },
  scroll: {
    maxHeight: 360,
  },
  scrollContent: {
    gap: spacing.md,
  },
  roleBlock: {
    gap: spacing.xs,
  },
  chipRow: {
    gap: spacing.xs,
  },
  chip: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.backgroundTint,
    gap: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.brand.graphiteDepth,
    borderColor: colors.border.accent,
  },
  chipText: {
    fontFamily: 'Geist-SemiBold',
    fontSize: 13,
    color: colors.text.primary,
  },
  chipTextSelected: {
    color: colors.text.primary,
  },
  chipPreview: {
    fontFamily: 'GeistMono-Regular',
    fontSize: 11,
    color: colors.text.secondary,
  },
});
