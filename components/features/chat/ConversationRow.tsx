/**
 * One conversation row in the chat history drawer.
 */

import React from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import type { AgenticConversation } from '@/store/agenticChatStore';

import { formatConversationTimestamp } from './helpers';
import { drawerStyles as styles } from './styles/drawer';

interface ConversationRowProps {
  conversation: AgenticConversation;
  preview: string;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

export function ConversationRow({
  conversation,
  preview,
  active,
  onOpen,
  onDelete,
}: ConversationRowProps): React.JSX.Element {
  return (
    <View style={[styles.drawerRow, active && styles.drawerRowActive]}>
      <Pressable
        style={({ pressed }) => [styles.drawerRowMain, pressed && styles.drawerRowPressed]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open chat ${conversation.title}`}
      >
        <View style={styles.drawerRowText}>
          <View style={styles.drawerRowTitleLine}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={styles.drawerRowTitle}
              numberOfLines={1}
            >
              {conversation.title}
            </Text>
            <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
              {formatConversationTimestamp(conversation.updatedAt)}
            </Text>
          </View>
          <Text
            variant="small"
            color={colors.text.secondary}
            style={styles.drawerRowPreview}
            numberOfLines={1}
          >
            {preview}
          </Text>
        </View>
      </Pressable>
      <View style={styles.drawerRowActions}>
        <Pressable
          style={({ pressed }) => [styles.drawerMiniButton, pressed && styles.drawerRowPressed]}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete chat"
          hitSlop={6}
        >
          <Ionicons name="trash-outline" size={18} color={colors.semantic.error} />
        </Pressable>
      </View>
    </View>
  );
}
