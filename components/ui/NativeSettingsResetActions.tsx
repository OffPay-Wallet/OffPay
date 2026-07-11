import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { layout, radii, spacing } from '@/constants/spacing';

import type { NativeSettingsResetActionsProps } from './NativeSettingsResetActions.types';

export type { NativeSettingsResetActionsProps } from './NativeSettingsResetActions.types';

export function NativeSettingsResetActions({
  busy,
  cancelBackgroundColor,
  cancelBorderColor,
  cancelTextColor,
  confirmBackgroundColor,
  confirmTextColor,
  onCancel,
  onConfirm,
}: NativeSettingsResetActionsProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: cancelBackgroundColor,
            borderColor: cancelBorderColor,
            opacity: pressed && !busy ? 0.82 : 1,
          },
        ]}
        onPress={onCancel}
        unstable_pressDelay={0}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Cancel reset"
        accessibilityState={{ disabled: busy }}
        testID="settings-reset-cancel"
      >
        <Text variant="button" color={cancelTextColor} align="center" numberOfLines={1}>
          Cancel
        </Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: confirmBackgroundColor,
            borderColor: confirmBackgroundColor,
            opacity: pressed && !busy ? 0.86 : busy ? 0.56 : 1,
          },
        ]}
        onPress={onConfirm}
        unstable_pressDelay={0}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Confirm reset and erase this device"
        accessibilityState={{ busy, disabled: busy }}
        testID="settings-reset-confirm"
      >
        <Text variant="button" color={confirmTextColor} align="center" numberOfLines={1}>
          {busy ? 'Resetting…' : 'Reset'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
});
