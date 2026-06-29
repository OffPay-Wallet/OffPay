import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppToast } from '@/components/ui/AppToast';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { Text } from '@/components/ui/Text';
import { PuffyAddContactIcon } from '@/components/ui/icons/PuffyAddContactIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import {
  getContactByAddress,
  normalizeContactName,
  type SavedContact,
  useContactsStore,
} from '@/store/contactsStore';

interface ContactsModalProps {
  visible: boolean;
  onClose: () => void;
}

type ContactEditorMode = 'add' | 'edit' | null;

const SHEET_SHADOW = '0 18px 36px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const SHEET_TIMING = { duration: 260, easing: Easing.out(Easing.cubic) } as const;
const FADE_TIMING = { duration: 200 } as const;

export function ContactsModal({ visible, onClose }: ContactsModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const contacts = useContactsStore((s) => s.contacts);
  const upsertContact = useContactsStore((s) => s.upsertContact);
  const deleteContact = useContactsStore((s) => s.deleteContact);
  const [mounted, setMounted] = useState(visible);
  const [editorMode, setEditorMode] = useState<ContactEditorMode>(null);
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAddress, setDraftAddress] = useState('');

  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;
  const sheetMaxWidth = 430;
  const maxSheetHeight = windowHeight - insets.top - overlayPaddingBottom - spacing.lg;
  const listMaxHeight = Math.max(160, maxSheetHeight - (editorMode == null ? 160 : 340));
  const normalizedName = useMemo(() => normalizeContactName(draftName), [draftName]);
  const normalizedAddress = draftAddress.trim();
  const existingContact = getContactByAddress(contacts, normalizedAddress);
  const duplicateContact =
    existingContact != null &&
    (editingAddress == null || existingContact.address !== editingAddress);
  const canSave = normalizedName.length > 0 && isValidSolanaAddress(normalizedAddress);
  const sortedContacts = useMemo(
    () =>
      [...contacts].sort((left, right) => {
        return left.name.localeCompare(right.name) || left.address.localeCompare(right.address);
      }),
    [contacts],
  );

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(windowHeight);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, FADE_TIMING);
      translateY.value = withTiming(0, SHEET_TIMING);
      return;
    }

    opacity.value = withTiming(0, FADE_TIMING);
    translateY.value = withTiming(
      windowHeight,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setMounted)(false);
      },
    );
  }, [opacity, translateY, visible, windowHeight]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const closeWithAnimation = useCallback((): void => {
    Keyboard.dismiss();
    opacity.value = withTiming(0, FADE_TIMING);
    translateY.value = withTiming(
      windowHeight,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClose)();
      },
    );
  }, [onClose, opacity, translateY, windowHeight]);

  const resetEditor = useCallback((): void => {
    setEditorMode(null);
    setEditingAddress(null);
    setDraftName('');
    setDraftAddress('');
  }, []);

  const openAddEditor = useCallback((): void => {
    setEditorMode('add');
    setEditingAddress(null);
    setDraftName('');
    setDraftAddress('');
  }, []);

  const openEditEditor = useCallback((contact: SavedContact): void => {
    setEditorMode('edit');
    setEditingAddress(contact.address);
    setDraftName(contact.name);
    setDraftAddress(contact.address);
  }, []);

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    if (duplicateContact) {
      showToast({
        title: 'Contact already saved',
        message: existingContact?.name ?? shortenWalletAddress(normalizedAddress),
        variant: 'warning',
      });
      return;
    }

    const saved = upsertContact({
      name: normalizedName,
      address: normalizedAddress,
      editingAddress,
    });
    if (saved == null) {
      showToast({
        title: 'Contact not saved',
        message: 'Check the wallet address and try again.',
        variant: 'error',
      });
      return;
    }
    if (editingAddress != null && editingAddress !== saved.address) {
      deleteContact(editingAddress);
    }
    showToast({ title: 'Contact saved', message: saved.name, variant: 'success' });
    resetEditor();
    Keyboard.dismiss();
  }, [
    canSave,
    deleteContact,
    duplicateContact,
    editingAddress,
    existingContact,
    normalizedAddress,
    normalizedName,
    resetEditor,
    showToast,
    upsertContact,
  ]);

  const handleDelete = useCallback(
    (contact: SavedContact): void => {
      deleteContact(contact.address);
      if (editingAddress === contact.address) resetEditor();
      showToast({ title: 'Contact deleted', message: contact.name, variant: 'success' });
    },
    [deleteContact, editingAddress, resetEditor, showToast],
  );

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim />
        <TouchableWithoutFeedback onPress={closeWithAnimation}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      <View
        style={[
          styles.overlay,
          { paddingBottom: overlayPaddingBottom, paddingHorizontal: horizontalPadding },
        ]}
        accessibilityViewIsModal
        accessibilityLabel="Contacts"
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              width: '100%',
              maxWidth: sheetMaxWidth,
              maxHeight: maxSheetHeight,
            },
            sheetStyle,
          ]}
        >
          <View style={[styles.header, compact && styles.headerCompact]}>
            <View style={styles.headerSide}>
              <View style={styles.headerIconPlaceholder} />
            </View>
            <Text
              variant="h2"
              color={colors.text.primary}
              style={[styles.headerTitle, compact && styles.headerTitleCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              Contacts
            </Text>
            <View style={[styles.headerSide, styles.headerRight]}>
              <Pressable
                style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
                onPress={closeWithAnimation}
                accessibilityRole="button"
                accessibilityLabel="Close contacts"
                hitSlop={6}
              >
                <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
              </Pressable>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.toolbar}>
              <Text variant="bodyBold" color={colors.text.secondary} numberOfLines={1}>
                {contacts.length} saved
              </Text>
              <Pressable
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                onPress={openAddEditor}
                accessibilityRole="button"
                accessibilityLabel="Add contact"
              >
                <PuffyAddContactIcon
                  size={20}
                  color={colors.text.onAccent}
                  shadowColor={colors.text.primary}
                />
                <Text variant="buttonSmall" color={colors.text.onAccent} numberOfLines={1}>
                  Add
                </Text>
              </Pressable>
            </View>

            {editorMode != null ? (
              <View style={styles.editorCard}>
                <View style={styles.editorHeader}>
                  <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
                    {editorMode === 'edit' ? 'Edit contact' : 'New contact'}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.editorCloseButton, pressed && styles.pressed]}
                    onPress={resetEditor}
                    accessibilityRole="button"
                    accessibilityLabel="Close contact editor"
                    hitSlop={6}
                  >
                    <Ionicons
                      name="close"
                      size={layout.iconSizeInline}
                      color={colors.text.secondary}
                    />
                  </Pressable>
                </View>
                <View style={styles.inputShell}>
                  <TextInput
                    value={draftName}
                    onChangeText={setDraftName}
                    placeholder="Name"
                    placeholderTextColor={colors.text.placeholder}
                    selectionColor={colors.brand.glossAccent}
                    autoCapitalize="words"
                    autoCorrect={false}
                    style={styles.input}
                    returnKeyType="next"
                  />
                </View>
                <View style={styles.inputShell}>
                  <TextInput
                    value={draftAddress}
                    onChangeText={setDraftAddress}
                    placeholder="Wallet address"
                    placeholderTextColor={colors.text.placeholder}
                    selectionColor={colors.brand.glossAccent}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    scrollEnabled={false}
                    style={[styles.input, styles.addressInput]}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                  />
                </View>
                <Pressable
                  style={({ pressed }) => [
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
                    Save Contact
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {contacts.length === 0 ? (
              <View style={styles.emptyState}>
                <PuffyAddContactIcon
                  size={layout.iconSizeTab}
                  color={colors.text.secondary}
                  shadowColor={colors.brand.glossAccent}
                  focused={false}
                />
                <Text variant="bodyBold" color={colors.text.primary} align="center">
                  No contacts yet
                </Text>
                <Text
                  variant="small"
                  color={colors.text.secondary}
                  align="center"
                  style={styles.emptyCopy}
                >
                  Save wallet names locally for faster sends.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: listMaxHeight }}
                contentContainerStyle={styles.contactList}
                contentInsetAdjustmentBehavior="automatic"
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {sortedContacts.map((contact) => (
                  <ContactRow
                    key={contact.address}
                    contact={contact}
                    onEdit={openEditEditor}
                    onDelete={handleDelete}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const ContactRow = React.memo(function ContactRow({
  contact,
  onEdit,
  onDelete,
}: {
  contact: SavedContact;
  onEdit: (contact: SavedContact) => void;
  onDelete: (contact: SavedContact) => void;
}): React.JSX.Element {
  const handleEdit = useCallback(() => {
    onEdit(contact);
  }, [contact, onEdit]);
  const handleDelete = useCallback(() => {
    onDelete(contact);
  }, [contact, onDelete]);

  return (
    <View style={styles.contactRow}>
      <View style={styles.contactAvatar}>
        <Text variant="bodyBold" color={colors.text.onAccent} numberOfLines={1}>
          {contact.name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.contactText}>
        <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
          {contact.name}
        </Text>
        <CopyableAddress
          address={contact.address}
          label={shortenWalletAddress(contact.address)}
          color={colors.text.secondary}
          iconSize={16}
          maxFontSizeMultiplier={1}
        />
      </View>
      <View style={styles.contactActions}>
        <Pressable
          style={({ pressed }) => [styles.rowIconButton, pressed && styles.pressed]}
          onPress={handleEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${contact.name}`}
          hitSlop={6}
        >
          <Ionicons
            name="create-outline"
            size={layout.iconSizeInline}
            color={colors.text.primary}
          />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.rowIconButton, pressed && styles.pressed]}
          onPress={handleDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${contact.name}`}
          hitSlop={6}
        >
          <Ionicons
            name="trash-outline"
            size={layout.iconSizeInline}
            color={colors.semantic.error}
          />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: SHEET_SHADOW,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerCompact: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  headerSide: {
    width: layout.minTouchTarget,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerIconPlaceholder: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  headerTitleCompact: {
    fontSize: 24,
    lineHeight: 28,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  toolbar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  addButton: {
    minHeight: layout.buttonHeightSm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.brand.glossAccent,
  },
  editorCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.textBacking,
  },
  editorHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  editorCloseButton: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputShell: {
    minHeight: 48,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.solidControl,
  },
  input: {
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: 0,
  },
  addressInput: {
    minHeight: 42,
    textAlignVertical: 'center',
  },
  saveButton: {
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
  },
  saveButtonPressed: {
    backgroundColor: colors.surface.glossPressed,
  },
  contactList: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  contactRow: {
    minHeight: 68,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
  },
  contactAvatar: {
    width: 38,
    height: 38,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    flexShrink: 0,
  },
  contactText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  contactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  rowIconButton: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  emptyState: {
    minHeight: 180,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
  },
  emptyCopy: {
    lineHeight: 18,
  },
  disabled: {
    opacity: 0.44,
  },
  pressed: {
    opacity: 0.76,
  },
});
