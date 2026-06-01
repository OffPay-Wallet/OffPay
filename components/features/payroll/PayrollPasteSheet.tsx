/**
 * Modal sheet for pasting raw payroll rows (CSV/TSV/JSON/plain text) or
 * entering them manually. Submits the pasted text through the same staging
 * pipeline as a file upload (`stageFromText`), so paste and upload share one
 * validation/route path.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import { payrollStyles as styles } from './styles';

interface PayrollPasteSheetProps {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fileName: string, text: string) => void;
}

export function PayrollPasteSheet({
  visible,
  busy,
  onClose,
  onSubmit,
}: PayrollPasteSheetProps): React.JSX.Element {
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    // Name it so format detection falls back to delimiter sniffing / JSON.
    const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    onSubmit(looksJson ? 'pasted-payroll.json' : 'pasted-payroll.txt', trimmed);
    setText('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={pasteStyles.backdrop} onPress={onClose}>
        <Pressable style={pasteStyles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Paste payroll</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.claimNote}>
            Paste rows as CSV, TSV, or JSON. Include a header row with recipient and amount columns.
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={'wallet,amount\nAbc...123,100\nDef...456,50'}
            placeholderTextColor={colors.text.placeholder}
            style={pasteStyles.input}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Payroll rows"
          />

          <Pressable
            style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Stage pasted payroll"
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.primaryButtonText}>Stage payroll</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const pasteStyles = StyleSheet.create({
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
  },
  input: {
    minHeight: 160,
    maxHeight: 280,
    borderRadius: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    padding: spacing.md,
    fontFamily: 'GeistMono-Regular',
    fontSize: 13,
    color: colors.text.primary,
    backgroundColor: colors.brand.whiteStream,
    textAlignVertical: 'top',
  },
});
