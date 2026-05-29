/**
 * Chat header — back button, title, history toggle. Pure presentation.
 */

import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';

import { headerStyles as styles } from './styles/header';

interface ChatHeaderProps {
  topInset: number;
  horizontalPadding: number;
  onBack: () => void;
  onOpenHistory: () => void;
}

export function ChatHeader({
  topInset,
  horizontalPadding,
  onBack,
  onOpenHistory,
}: ChatHeaderProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.header,
        { paddingTop: topInset + spacing.sm, paddingHorizontal: horizontalPadding },
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={6}
      >
        <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.text.primary} />
      </Pressable>

      <Text
        variant="h2"
        color={colors.text.primary}
        style={styles.headerTitle}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        Yuga
      </Text>

      <Pressable
        style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
        onPress={onOpenHistory}
        accessibilityRole="button"
        accessibilityLabel="Open chat history"
        hitSlop={6}
      >
        <Ionicons name="chatbubbles-outline" size={20} color={colors.text.primary} />
      </Pressable>
    </View>
  );
}
