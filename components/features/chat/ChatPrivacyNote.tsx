/**
 * Empty-state privacy note — centered on screen until the first message.
 */

import React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import { privacyNoteStyles as styles } from './styles/privacy-note';

interface ChatPrivacyNoteProps {
  horizontalPadding: number;
}

export function ChatPrivacyNote({ horizontalPadding }: ChatPrivacyNoteProps): React.JSX.Element {
  return (
    <View
      style={[styles.screenOverlay, { paddingHorizontal: horizontalPadding }]}
      accessibilityRole="text"
    >
      <View style={styles.card}>
        <Text color={colors.text.secondary} style={styles.text}>
          Your wallet data stays on this device.
        </Text>
        <Text color={colors.text.tertiary} style={styles.text}>
          Yuga only sees what you type.
        </Text>
      </View>
    </View>
  );
}
