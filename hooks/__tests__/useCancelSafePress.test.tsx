import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  useCancelSafePress,
  type CancelSafePressState,
} from '@/hooks/useCancelSafePress';

interface HarnessProps {
  disabled?: boolean;
  onPress: () => void;
}

let pressState: CancelSafePressState | null = null;

function Harness({ disabled = false, onPress }: HarnessProps): null {
  pressState = useCancelSafePress({ disabled, onPress });
  return null;
}

describe('useCancelSafePress', () => {
  afterEach(() => {
    pressState = null;
  });

  it('clears the pressed shade when a scroll view terminates the responder', () => {
    const onPress = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<Harness onPress={onPress} />);
    });

    act(() => {
      pressState?.onPressIn();
    });
    expect(pressState?.pressed).toBe(true);
    expect(pressState?.onResponderTerminationRequest()).toBe(true);

    act(() => {
      pressState?.onResponderTerminate();
    });
    expect(pressState?.pressed).toBe(false);
    expect(onPress).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('clears the pressed shade before running the row action', () => {
    const onPress = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<Harness onPress={onPress} />);
    });

    act(() => {
      pressState?.onPressIn();
      pressState?.onPress();
    });

    expect(pressState?.pressed).toBe(false);
    expect(onPress).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });
  });

  it('clears and suppresses press state when the row becomes disabled', () => {
    const onPress = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(<Harness onPress={onPress} />);
    });
    act(() => {
      pressState?.onPressIn();
    });
    expect(pressState?.pressed).toBe(true);

    act(() => {
      renderer.update(<Harness disabled onPress={onPress} />);
    });
    expect(pressState?.pressed).toBe(false);

    act(() => {
      pressState?.onPressIn();
      pressState?.onPress();
    });
    expect(pressState?.pressed).toBe(false);
    expect(onPress).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });
});
