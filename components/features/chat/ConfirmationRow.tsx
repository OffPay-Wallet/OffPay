/**
 * One row in the agentic transfer confirmation card. Optionally tappable —
 * transaction rows use this to copy the full local signature/queue id.
 */

import React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

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
  const valueElement = (
    <Text
      variant="captionBold"
      color={valueColor ?? (onPress != null ? colors.brand.glossAccent : colors.text.primary)}
      style={[
        styles.confirmationRowValue,
        mono === true && styles.monoText,
        onPress != null && styles.confirmationRowValueLink,
      ]}
      numberOfLines={1}
      ellipsizeMode="middle"
    >
      {value}
    </Text>
  );

  return (
    <View style={styles.confirmationRow}>
      <Text variant="small" color={colors.text.tertiary} style={styles.confirmationRowLabel}>
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
