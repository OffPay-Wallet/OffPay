import { Button, Host, HStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  frame,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { layout, spacing } from '@/constants/spacing';

import type { NativeSettingsResetActionsProps } from './NativeSettingsResetActions.types';

export function NativeSettingsResetActions({
  busy,
  cancelTextColor,
  confirmBackgroundColor,
  onCancel,
  onConfirm,
}: NativeSettingsResetActionsProps): React.JSX.Element {
  return (
    <Host
      style={{ width: '100%', height: layout.buttonHeightMd }}
      seedColor={confirmBackgroundColor}
    >
      <HStack spacing={spacing.md}>
        <Button
          label="Cancel"
          role="cancel"
          onPress={onCancel}
          modifiers={[
            buttonStyle('bordered'),
            controlSize('large'),
            tint(cancelTextColor),
            frame({ maxWidth: Number.POSITIVE_INFINITY, minHeight: layout.buttonHeightMd }),
            disabledModifier(busy),
            accessibilityLabel('Cancel reset'),
          ]}
          testID="settings-reset-cancel"
        />
        <Button
          label={busy ? 'Resetting…' : 'Reset'}
          role="destructive"
          onPress={onConfirm}
          modifiers={[
            buttonStyle('borderedProminent'),
            controlSize('large'),
            tint(confirmBackgroundColor),
            frame({ maxWidth: Number.POSITIVE_INFINITY, minHeight: layout.buttonHeightMd }),
            disabledModifier(busy),
            accessibilityLabel('Confirm reset and erase this device'),
          ]}
          testID="settings-reset-confirm"
        />
      </HStack>
    </Host>
  );
}
