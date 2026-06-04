import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { StyleProp, TextStyle } from 'react-native';

interface CopyableAddressProps {
  address: string;
  label?: string;
  color?: string;
  iconSize?: number;
  maxFontSizeMultiplier?: number;
  textStyle?: StyleProp<TextStyle>;
}

export function CopyableAddress({
  address,
  label,
  color = colors.text.secondary,
  iconSize = layout.iconSizeInline,
  maxFontSizeMultiplier,
  textStyle,
}: CopyableAddressProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncated =
    address && address.length > 10
      ? `${address.slice(0, 4)}...${address.slice(-4)}`
      : address || '—';

  const displayText = label || truncated;

  return (
    <Pressable style={styles.container} onPress={handleCopy} hitSlop={8}>
      <Text
        variant="bodyBold"
        color={color}
        style={[styles.addressText, !label ? styles.addressMono : undefined, textStyle]}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={maxFontSizeMultiplier}
      >
        {displayText}
      </Text>
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={iconSize}
        color={copied ? colors.semantic.success : color}
        style={styles.copyIcon}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
    flexShrink: 1,
  },
  addressText: {
    minWidth: 0,
    flexShrink: 1,
  },
  addressMono: {
    fontFamily: fontFamily.mono,
  },
  copyIcon: {
    flexShrink: 0,
  },
});
