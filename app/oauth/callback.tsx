import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/expo';
import { router } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { ProcessResultScreen, type ProcessResultVariant } from '@/components/ui/ProcessResultScreen';

const CALLBACK_TIMEOUT_MS = 5000;
const CALLBACK_EXIT_DELAY_MS = 220;
const CALLBACK_RESULT_FALLBACK_MS = 3200;

export default function OAuthCallbackScreen(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const { user } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  const [resultVisible, setResultVisible] = useState(true);
  const callbackDoneRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lottieSize = Math.round(Math.min(Math.max(width * 0.54, 210), 280));
  const resultReady = user != null || timedOut;

  useEffect(() => {
    if (user != null) {
      setTimedOut(false);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setTimedOut(true);
    }, CALLBACK_TIMEOUT_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [user]);

  const completeCallback = useCallback((): void => {
    if (callbackDoneRef.current) return;
    callbackDoneRef.current = true;

    if (user != null) {
      exitTimerRef.current = setTimeout(() => {
        router.replace({
          pathname: '/security-setup/passcode',
          params: { intent: 'privy-wallet' },
        });
      }, CALLBACK_EXIT_DELAY_MS);
      return;
    }

    if (timedOut) {
      exitTimerRef.current = setTimeout(() => {
        router.replace('/onboarding');
      }, CALLBACK_EXIT_DELAY_MS);
    }
  }, [timedOut, user]);

  useEffect(() => {
    if (user == null && !timedOut) return;

    callbackDoneRef.current = false;
    setResultVisible(true);
    const timeout = setTimeout(completeCallback, CALLBACK_RESULT_FALLBACK_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [completeCallback, timedOut, user]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current != null) {
        clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  const variant: ProcessResultVariant = timedOut ? 'error' : 'success';

  return (
    <ProcessResultScreen
      visible={resultReady && resultVisible}
      variant={variant}
      title={timedOut ? 'Failed' : 'Success'}
      animationSize={lottieSize}
      onAnimationFinish={completeCallback}
      minimal
    />
  );
}
