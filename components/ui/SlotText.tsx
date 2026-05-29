import { useEffect, useRef } from 'react';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';

import { Text } from '@/components/ui/Text';

import type { ComponentProps } from 'react';

type TextProps = ComponentProps<typeof Text>;

interface SlotTextProps extends TextProps {
  value: string;
}

export function SlotText({ value, ...props }: SlotTextProps): React.JSX.Element {
  const hasMountedRef = useRef(false);
  const shouldAnimate = hasMountedRef.current;

  useEffect(() => {
    hasMountedRef.current = true;
  }, []);

  return (
    <Animated.View
      key={value}
      entering={shouldAnimate ? FadeIn.duration(180) : undefined}
      exiting={shouldAnimate ? FadeOut.duration(140) : undefined}
      style={styles.container}
    >
      <Text {...props}>{value}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
