/**
 * Manual column-mapping sheet. Shown when payroll staging parsed the file but
 * could not auto-detect the recipient/amount columns. The user assigns each
 * role to one of the parsed headers; recipient + amount are required, token
 * and label are optional. Submitting re-stages with the chosen mapping.
 */

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
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
  { role: 'label', label: 'Employee name (optional)', required: false },
];

export function PayrollColumnMapSheet({
  visible,
  busy,
  headers,
  sampleRows,
  suggestedMapping,
  onClose,
  onSubmit,
}: PayrollColumnMapSheetProps): React.JSX.Element {
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

  const preview = (header: string): string => {
    const value = sampleRows.find((row) => row[header]?.length > 0)?.[header];
    return value != null && value.length > 0 ? value : '—';
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={mapStyles.backdrop} onPress={onClose}>
        <Pressable style={mapStyles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Map columns</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.claimNote}>
            We could not detect the columns. Tap a column to assign each role.
          </Text>

          <ScrollView style={mapStyles.scroll}>
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
        </Pressable>
      </Pressable>
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
    backgroundColor: colors.surface.cardElevated,
    borderTopLeftRadius: spacing.xl,
    borderTopRightRadius: spacing.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '80%',
  },
  scroll: {
    maxHeight: 360,
  },
  roleBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    backgroundColor: colors.glass.clearFill,
    minWidth: 96,
  },
  chipSelected: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.deepShadow,
  },
  chipText: {
    fontFamily: 'Geist-SemiBold',
    fontSize: 13,
    color: colors.text.primary,
  },
  chipTextSelected: {
    color: colors.brand.deepShadow,
  },
  chipPreview: {
    fontFamily: 'GeistMono-Regular',
    fontSize: 11,
    color: colors.text.secondary,
  },
});
