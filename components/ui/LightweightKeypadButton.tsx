import { memo } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

interface LightweightKeypadButtonProps {
  children: React.ReactNode;
  frameStyle: ViewStyle;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
  accessibilityRole?: 'button' | 'keyboardkey';
  accessibilityLabel?: string;
}

export const LightweightKeypadButton = memo(function LightweightKeypadButton({
  children,
  frameStyle,
  onPress,
  disabled = false,
  muted = false,
  accessibilityRole = 'button',
  accessibilityLabel,
}: LightweightKeypadButtonProps): React.JSX.Element {
  return (
    <View style={frameStyle}>
      <Pressable
        style={({ pressed }) => [
          styles.key,
          muted && styles.keyMuted,
          pressed && !disabled && styles.keyPressed,
        ]}
        onPress={onPress}
        disabled={disabled}
        unstable_pressDelay={0}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
    </View>
  );
}, areLightweightKeypadButtonPropsEqual);

function areLightweightKeypadButtonPropsEqual(
  previous: LightweightKeypadButtonProps,
  next: LightweightKeypadButtonProps,
): boolean {
  return (
    previous.frameStyle === next.frameStyle &&
    previous.onPress === next.onPress &&
    previous.disabled === next.disabled &&
    previous.muted === next.muted &&
    previous.accessibilityRole === next.accessibilityRole &&
    previous.accessibilityLabel === next.accessibilityLabel
  );
}

const styles = StyleSheet.create({
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  keyPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    transform: [{ scale: 0.97 }],
  },
  keyMuted: {
    opacity: 0.5,
  },
});
