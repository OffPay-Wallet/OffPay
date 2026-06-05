import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/expo';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';

const CALLBACK_TIMEOUT_MS = 5000;
const CALLBACK_REDIRECT_DELAY_MS = 80;

export default function OAuthCallbackScreen(): React.JSX.Element {
  const { user } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  const callbackDoneRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    exitTimerRef.current = setTimeout(() => {
      router.replace({
        pathname: '/onboarding',
        params: { authResult: user != null ? 'success' : 'failed' },
      });
    }, CALLBACK_REDIRECT_DELAY_MS);
  }, [user]);

  useEffect(() => {
    if (user == null && !timedOut) return;

    callbackDoneRef.current = false;
    completeCallback();
  }, [completeCallback, timedOut, user]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current != null) {
        clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  return <View style={styles.screen} accessibilityElementsHidden={!resultReady} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.background,
  },
});
