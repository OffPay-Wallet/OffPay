import { useCallback, useEffect, useState } from 'react';

interface UseCancelSafePressOptions {
  disabled?: boolean;
  onPress?: () => void;
}

export interface CancelSafePressState {
  pressed: boolean;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  onResponderTerminate: () => void;
  onResponderTerminationRequest: () => boolean;
}

/**
 * Owns visual press state so interrupted gestures cannot leave a control
 * highlighted after a parent scroll view takes over the responder.
 */
export function useCancelSafePress({
  disabled = false,
  onPress,
}: UseCancelSafePressOptions): CancelSafePressState {
  const [pressed, setPressed] = useState(false);
  const interactive = !disabled && onPress != null;

  const resetPressed = useCallback((): void => {
    setPressed(false);
  }, []);

  const handlePressIn = useCallback((): void => {
    if (interactive) {
      setPressed(true);
    }
  }, [interactive]);

  const handlePress = useCallback((): void => {
    resetPressed();
    if (interactive) {
      onPress?.();
    }
  }, [interactive, onPress, resetPressed]);

  const allowResponderTermination = useCallback((): boolean => true, []);

  useEffect(() => {
    if (!interactive) {
      resetPressed();
    }
  }, [interactive, resetPressed]);

  return {
    pressed,
    onPress: handlePress,
    onPressIn: handlePressIn,
    onPressOut: resetPressed,
    onResponderTerminate: resetPressed,
    onResponderTerminationRequest: allowResponderTermination,
  };
}
