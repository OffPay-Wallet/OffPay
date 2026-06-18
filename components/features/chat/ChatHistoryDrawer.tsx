/**
 * Slide-in drawer that lists scoped chat conversations.
 * Uses FlashList so the drawer stays responsive as history grows.
 */

import React, { useCallback, useMemo } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text } from '@/components/ui/Text';
import { useReanimatedModalProgress } from '@/components/ui/useReanimatedModalProgress';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import type { AgenticChatMessage, AgenticConversation } from '@/store/agenticChatStore';

import { ConversationRow } from './ConversationRow';
import { getConversationPreview } from './helpers';
import { drawerStyles as styles } from './styles/drawer';

interface ChatHistoryDrawerProps {
  visible: boolean;
  conversations: readonly AgenticConversation[];
  messages: readonly AgenticChatMessage[];
  activeConversationId: string | null;
  width: number;
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  onNewChat: () => void;
  onOpenConversation: (conversation: AgenticConversation) => void;
  onDeleteConversation: (conversationId: string) => void;
}

type DrawerListItem =
  | {
      kind: 'header';
      key: string;
      title: string;
    }
  | {
      kind: 'empty';
      key: string;
      label: string;
    }
  | {
      kind: 'row';
      key: string;
      conversation: AgenticConversation;
      preview: string;
      active: boolean;
    };

export function ChatHistoryDrawer({
  visible,
  conversations,
  messages,
  activeConversationId,
  width,
  topInset,
  bottomInset,
  onClose,
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
}: ChatHistoryDrawerProps): React.JSX.Element | null {
  const items = useMemo<DrawerListItem[]>(() => {
    const list: DrawerListItem[] = [];

    list.push({ kind: 'header', key: 'recent-header', title: 'Recent' });
    if (conversations.length === 0) {
      list.push({ kind: 'empty', key: 'recent-empty', label: 'No chats yet' });
    } else {
      for (const conversation of conversations) {
        list.push({
          kind: 'row',
          key: conversation.id,
          conversation,
          preview: getConversationPreview(conversation.id, messages),
          active: conversation.id === activeConversationId,
        });
      }
    }

    return list;
  }, [activeConversationId, conversations, messages]);

  const keyExtractor = useCallback((item: DrawerListItem) => item.key, []);
  const getItemType = useCallback((item: DrawerListItem) => item.kind, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DrawerListItem>) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.drawerSectionHeader}>
            <Text
              variant="captionBold"
              color={colors.text.tertiary}
              style={styles.drawerSectionTitle}
            >
              {item.title}
            </Text>
          </View>
        );
      }

      if (item.kind === 'empty') {
        return (
          <Text variant="small" color={colors.text.tertiary} style={styles.drawerEmptyText}>
            {item.label}
          </Text>
        );
      }

      return (
        <ConversationRow
          conversation={item.conversation}
          preview={item.preview}
          active={item.active}
          onOpen={() => onOpenConversation(item.conversation)}
          onDelete={() => onDeleteConversation(item.conversation.id)}
        />
      );
    },
    [onDeleteConversation, onOpenConversation],
  );
  const { mounted, progress } = useReanimatedModalProgress(visible);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * -width }],
  }));

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.drawerRoot, rootStyle]}>
        <Pressable
          style={styles.drawerBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close chat history"
        />
        <Animated.View
          style={[
            styles.drawerPanel,
            {
              width,
              paddingTop: topInset + spacing.md,
              paddingBottom: Math.max(bottomInset, spacing.lg),
            },
            panelStyle,
          ]}
        >
          <View style={styles.drawerChrome}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerTitleStack}>
                <Text color={colors.text.primary} style={styles.drawerTitle} numberOfLines={1}>
                  Chats
                </Text>
                <Text color={colors.text.secondary} style={styles.drawerSubtitle} numberOfLines={1}>
                  Local Yuga history
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.drawerIconButton,
                  pressed && styles.drawerRowPressed,
                ]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close chat history"
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={colors.text.primary} />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.newChatRow, pressed && styles.drawerRowPressed]}
              onPress={onNewChat}
              accessibilityRole="button"
              accessibilityLabel="Create new chat"
            >
              <Ionicons name="create-outline" size={20} color={colors.text.onAccent} />
              <Text style={styles.newChatLabel}>New chat</Text>
            </Pressable>
          </View>

          <View style={styles.drawerList}>
            <FlashList<DrawerListItem>
              data={items}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.drawerListContent}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
