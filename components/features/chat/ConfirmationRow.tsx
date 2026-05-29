/**
 * One row in the agentic transfer confirmation card. Optionally tappable —
 * when `onPress` is provided the row renders as an underlined link so the
 * user can open the signature in Solscan.
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
}

export function ConfirmationRow({
  label,
  value,
  mono,
  onPress,
  accessibilityLabel,
}: ConfirmationRowProps): React.JSX.Element {
  const valueElement = (
    <Text
      variant="captionBold"
      color={onPress != null ? colors.brand.azureCyan : colors.text.primary}
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
          accessibilityRole="link"
          accessibilityLabel={accessibilityLabel ?? `Open ${label}`}
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
