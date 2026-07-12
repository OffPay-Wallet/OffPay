/**
 * One row in the agentic transfer confirmation card. Optionally tappable —
 * transaction rows use this to copy the full local signature/queue id.
 */

import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import { isCompactChatCardLayout } from './constants';
import { confirmationStyles as styles } from './styles/confirmation';

interface ConfirmationRowProps {
  label: string;
  value: string;
  mono?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  valueColor?: string;
}

export function ConfirmationRow({
  label,
  value,
  mono,
  onPress,
  accessibilityLabel,
  valueColor,
}: ConfirmationRowProps): React.JSX.Element {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const compact = isCompactChatCardLayout(windowWidth, fontScale);
  const valueElement = (
    <Text
      variant="captionBold"
      color={valueColor ?? (onPress != null ? colors.brand.glossAccent : colors.text.primary)}
      style={[
        styles.confirmationRowValue,
        compact && styles.confirmationRowValueCompact,
        mono === true && styles.monoText,
        onPress != null && styles.confirmationRowValueLink,
      ]}
      numberOfLines={1}
      ellipsizeMode="middle"
      adjustsFontSizeToFit
      minimumFontScale={0.76}
      maxFontSizeMultiplier={1.15}
    >
      {value}
    </Text>
  );

  return (
    <View style={[styles.confirmationRow, compact && styles.confirmationRowCompact]}>
      <Text
        variant="small"
        color={colors.text.tertiary}
        style={[styles.confirmationRowLabel, compact && styles.confirmationRowLabelCompact]}
        numberOfLines={2}
        maxFontSizeMultiplier={1.15}
      >
        {label}
      </Text>
      {onPress != null ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? `Copy ${label}`}
          hitSlop={6}
          style={({ pressed }) => [
            styles.confirmationRowLink,
            compact && styles.confirmationRowLinkCompact,
            pressed && styles.confirmationRowLinkPressed,
          ]}
        >
          {valueElement}
        </Pressable>
      ) : (
        valueElement
      )}
    </View>
  );
}
