import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';

import type { ComponentProps } from 'react';
import type { WalletAccount } from '@/store/walletStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type AccountActionDialogState =
  | { type: 'set-primary-required'; wallet: WalletAccount }
  | { type: 'remove-wallet'; wallet: WalletAccount }
  | { type: 'only-wallet'; wallet: WalletAccount }
  | { type: 'remove-error'; wallet: WalletAccount; message: string };

interface AccountActionDialogProps {
  dialog: AccountActionDialogState | null;
  removing?: boolean;
  onClose: () => void;
  onConfirmRemove: () => void;
}

const GLASS_PANEL_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const CARD_MAX_WIDTH = 520;
const CARD_SHADOW =
  '0 8px 24px rgba(4, 28, 36, 0.16)';

function getDialogCopy(dialog: AccountActionDialogState): {
  icon: IoniconName;
  iconColor: string;
  title: string;
  message: string;
} {
  switch (dialog.type) {
    case 'set-primary-required':
      return {
        icon: 'key-outline',
        iconColor: colors.text.primary,
        title: 'Set as primary first',
        message: 'Make this wallet primary before exporting its keys.',
      };
    case 'remove-wallet':
      return {
        icon: 'trash-outline',
        iconColor: colors.semantic.error,
        title: 'Remove wallet?',
        message: `Remove ${dialog.wallet.name} from this device?`,
      };
    case 'only-wallet':
      return {
        icon: 'lock-closed-outline',
        iconColor: colors.text.primary,
        title: 'Keep one wallet',
        message: 'Create or import another wallet before removing this one.',
      };
    case 'remove-error':
      return {
        icon: 'alert-circle-outline',
        iconColor: colors.semantic.error,
        title: 'Unable to remove wallet',
        message: dialog.message,
      };
  }
}

export function AccountActionDialog({
  dialog,
  removing = false,
  onClose,
  onConfirmRemove,
}: AccountActionDialogProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();

  if (dialog == null) return null;

  const compact = width < 390 || fontScale > 1.08;
  const horizontalPadding = compact ? spacing.lg : spacing['2xl'];
  const cardWidth = Math.min(Math.max(width - horizontalPadding * 2, 0), CARD_MAX_WIDTH);
  const copy = getDialogCopy(dialog);
  const removeDialogOpen = dialog.type === 'remove-wallet';

  return (
    <Animated.View
      entering={FadeIn.duration(160).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(120).easing(Easing.out(Easing.cubic))}
      style={[
        styles.overlay,
        {
          paddingTop: insets.top + spacing.lg,
          paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg,
          paddingHorizontal: horizontalPadding,
        },
      ]}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close wallet action"
      />

      <Animated.View
        entering={FadeIn.duration(220).easing(Easing.out(Easing.cubic))}
        exiting={FadeOut.duration(120).easing(Easing.out(Easing.cubic))}
        style={{ width: cardWidth }}
      >
        <LinearGradient
          colors={[...GLASS_PANEL_COLORS]}
          start={{ x: 0.02, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          <View style={styles.header}>
            <View style={styles.iconBubble}>
              <Ionicons name={copy.icon} size={layout.iconSizeInline} color={copy.iconColor} />
            </View>
            <Text variant="h3" color={colors.text.primary} style={styles.title}>
              {copy.title}
            </Text>
          </View>

          <Text variant="body" color={colors.text.secondary} style={styles.message}>
            {copy.message}
          </Text>

          <View style={styles.actions}>
            {removeDialogOpen ? (
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel remove wallet"
              >
                <Text variant="buttonSmall" color={colors.text.primary}>
                  Cancel
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                removeDialogOpen && styles.destructiveButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={removeDialogOpen ? onConfirmRemove : onClose}
              accessibilityRole="button"
              accessibilityLabel={removeDialogOpen ? 'Remove wallet' : 'Close'}
              disabled={removing}
            >
              <Text
                variant="buttonSmall"
                color={removeDialogOpen ? colors.text.inverse : colors.text.onAccent}
              >
                {removeDialogOpen ? (removing ? 'Removing' : 'Remove') : 'OK'}
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 28, 35, 0.42)',
  },
  card: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.lg,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: CARD_SHADOW,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  message: {
    marginTop: spacing.md,
  },
  actions: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  primaryButton: {
    minHeight: layout.buttonHeightSm,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.azureCyan,
  },
  destructiveButton: {
    backgroundColor: colors.semantic.error,
  },
  secondaryButton: {
    minHeight: layout.buttonHeightSm,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  buttonPressed: {
    opacity: 0.76,
  },
});
