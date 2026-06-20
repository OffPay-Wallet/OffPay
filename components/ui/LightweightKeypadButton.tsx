import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

interface LightweightKeypadButtonProps {
  children: React.ReactNode;
  frameStyle: ViewStyle;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
  activateOnPressIn?: boolean;
  accessibilityRole?: 'button' | 'keyboardkey';
  accessibilityLabel?: string;
}

export const LightweightKeypadButton = memo(function LightweightKeypadButton({
  children,
  frameStyle,
  onPress,
  disabled = false,
  muted = false,
  activateOnPressIn = false,
  accessibilityRole = 'button',
  accessibilityLabel,
}: LightweightKeypadButtonProps): React.JSX.Element {
  const handledPressInRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  const resetPressState = useCallback((): void => {
    handledPressInRef.current = false;
    setPressed(false);
  }, []);

  const handlePressIn = useCallback((): void => {
    if (disabled) return;
    setPressed(true);
    if (!activateOnPressIn) return;
    handledPressInRef.current = true;
    onPress();
  }, [activateOnPressIn, disabled, onPress]);

  const handlePressOut = useCallback((): void => {
    setPressed(false);
  }, []);

  const handlePress = useCallback((): void => {
    if (activateOnPressIn && handledPressInRef.current) {
      handledPressInRef.current = false;
      setPressed(false);
      return;
    }
    setPressed(false);
    onPress();
  }, [activateOnPressIn, onPress]);

  useEffect(() => {
    if (disabled) {
      resetPressState();
    }
  }, [disabled, resetPressState]);

  return (
    <View style={frameStyle}>
      <Pressable
        style={[styles.key, muted && styles.keyMuted, pressed && !disabled && styles.keyPressed]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        onResponderTerminate={resetPressState}
        onResponderTerminationRequest={() => true}
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
    previous.activateOnPressIn === next.activateOnPressIn &&
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
    borderRadius: 999,
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
