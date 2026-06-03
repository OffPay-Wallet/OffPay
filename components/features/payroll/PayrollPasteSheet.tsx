/**
 * Modal sheet for pasting raw payroll rows (CSV/TSV/JSON/plain text) or
 * entering them manually. Submits the pasted text through the same staging
 * pipeline as a file upload (`stageFromText`), so paste and upload share one
 * validation/route path.
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import { payrollStyles as styles } from './styles';

interface PayrollPasteSheetProps {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fileName: string, text: string) => boolean | Promise<boolean>;
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

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    // Name it so format detection falls back to delimiter sniffing / JSON.
    const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    const accepted = await onSubmit(
      looksJson ? 'pasted-payroll.json' : 'pasted-payroll.txt',
      trimmed,
    );
    if (accepted) setText('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={pasteStyles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={pasteStyles.keyboardAvoider}
        >
          <View style={pasteStyles.sheet}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Paste payroll</Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.secondaryButtonText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.claimNote}>
              Paste CSV, TSV, JSON, or manual rows. Headerless rows can use wallet amount.
            </Text>

            <ScrollView keyboardShouldPersistTaps="always" style={pasteStyles.inputScroller}>
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
            </ScrollView>

            <Pressable
              style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
              onPress={() => {
                void handleSubmit();
              }}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Stage pasted payroll"
              accessibilityState={{ disabled: !canSubmit }}
            >
              <Text style={styles.primaryButtonText}>Stage payroll</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const pasteStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 16, 16, 0.32)',
    justifyContent: 'flex-end',
  },
  keyboardAvoider: {
    flex: 1,
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
  inputScroller: {
    maxHeight: 320,
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
