/**
 * Text component with typography variants.
 * Wraps React Native Text with pre-defined typography styles.
 *
 * Usage:
 *   <Text variant="h1">Hello</Text>
 *   <Text variant="body" color={colors.text.secondary}>Subtitle</Text>
 */
import { StyleSheet, Text as RNText } from 'react-native';

import { colors } from '@/constants/colors';
import { textStyles } from '@/constants/typography';

import type { TextProps as RNTextProps } from 'react-native';
import type { TextVariant } from '@/constants/typography';

interface TextProps extends RNTextProps {
  /** Typography variant — determines font size, weight, and line height */
  variant?: TextVariant;
  /** Text color override — defaults to text.primary */
  color?: string;
  /** Horizontal text alignment */
  align?: 'left' | 'center' | 'right';
}

export function Text({
  variant = 'body',
  color,
  align,
  style,
  children,
  ...rest
}: TextProps): React.JSX.Element {
  return (
    <RNText
      style={[
        styles.base,
        textStyles[variant],
        color != null && { color },
        align != null && { textAlign: align },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.text.primary,
  },
});
