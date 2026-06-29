import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAppToast } from '@/components/ui/AppToast';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { Text } from '@/components/ui/Text';
import { PuffyAddContactIcon } from '@/components/ui/icons/PuffyAddContactIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { getContactByAddress, normalizeContactName, useContactsStore } from '@/store/contactsStore';

interface ContactSavePromptProps {
  visible: boolean;
  address: string | null;
  initialName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function ContactSavePrompt({
  visible,
  address,
  initialName,
  onClose,
  onSaved,
}: ContactSavePromptProps): React.JSX.Element | null {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const upsertContact = useContactsStore((s) => s.upsertContact);
  const existingContact = useContactsStore((s) => getContactByAddress(s.contacts, address));
  const [draftName, setDraftName] = useState(initialName ?? '');

  useEffect(() => {
    if (visible) {
      setDraftName(initialName ?? '');
    }
  }, [initialName, visible]);

  const normalizedAddress = address?.trim() ?? '';
  const normalizedName = useMemo(() => normalizeContactName(draftName), [draftName]);
  const addressValid = isValidSolanaAddress(normalizedAddress);
  const canSave = addressValid && normalizedName.length > 0;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const compact = windowWidth < 390 || fontScale > 1.05;
  const maxWidth = Math.min(380, Math.max(280, windowWidth - spacing['2xl'] * 2));

  const handleClose = useCallback((): void => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    if (existingContact != null) {
      showToast({
        title: 'Contact already saved',
        message: existingContact.name,
        variant: 'warning',
      });
      return;
    }

    const saved = upsertContact({
      name: normalizedName,
      address: normalizedAddress,
    });
    if (saved == null) {
      showToast({
        title: 'Contact not saved',
        message: 'Enter a valid Solana wallet address.',
        variant: 'error',
      });
      return;
    }

    showToast({
      title: 'Contact saved',
      message: saved.name,
      variant: 'success',
    });
    Keyboard.dismiss();
    onSaved?.();
    onClose();
  }, [
    canSave,
    existingContact,
    normalizedAddress,
    normalizedName,
    onClose,
    onSaved,
    showToast,
    upsertContact,
  ]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.layer} accessibilityViewIsModal accessibilityLabel="Save contact">
        <Pressable
          style={styles.scrim}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss save contact"
        />
        <View style={[styles.card, { maxWidth }, dense && styles.cardDense]}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <PuffyAddContactIcon
                size={24}
                color={colors.text.onAccent}
                shadowColor={colors.text.primary}
              />
            </View>
            <View style={styles.headerText}>
              <Text
                variant={compact ? 'h3' : 'h2'}
                color={colors.text.primary}
                style={styles.title}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                Save Contact
              </Text>
              <Text variant="small" color={colors.text.secondary} numberOfLines={1}>
                Stored locally on this device.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={6}
            >
              <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
            </Pressable>
          </View>

          <View style={styles.form}>
            <View style={styles.inputShell}>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Name"
                placeholderTextColor={colors.text.placeholder}
                selectionColor={colors.brand.glossAccent}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSave}
                style={styles.input}
              />
            </View>
            <View style={styles.addressRow}>
              <CopyableAddress address={normalizedAddress} maxFontSizeMultiplier={1} />
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text variant="buttonSmall" color={colors.text.primary} numberOfLines={1}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.saveButton,
                pressed && canSave ? styles.saveButtonPressed : null,
                !canSave ? styles.disabled : null,
              ]}
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Save contact"
              accessibilityState={{ disabled: !canSave }}
            >
              <Text variant="buttonSmall" color={colors.text.onAccent} numberOfLines={1}>
                Save
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    padding: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  card: {
    width: '100%',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: '0 22px 42px rgba(0, 0, 0, 0.58), inset 0 1px 1px rgba(255, 255, 255, 0.14)',
  },
  cardDense: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    lineHeight: 28,
  },
  closeButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
  },
  form: {
    gap: spacing.sm,
  },
  inputShell: {
    minHeight: 52,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.textBacking,
  },
  input: {
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 0,
  },
  addressRow: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  button: {
    flex: 1,
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.surface.solidControl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  saveButton: {
    backgroundColor: colors.brand.glossAccent,
  },
  saveButtonPressed: {
    backgroundColor: colors.surface.glossPressed,
  },
  disabled: {
    opacity: 0.44,
  },
  pressed: {
    opacity: 0.76,
  },
});
