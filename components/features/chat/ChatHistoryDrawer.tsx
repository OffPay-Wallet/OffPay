/**
 * Slide-in drawer that lists scoped chat conversations (active +
 * archived). Pure presentation; the parent screen owns archive/unarchive/
 * delete intent and the open/close visibility flag.
 *
 * Uses FlashList for the conversation list so the drawer stays responsive
 * once history grows. Section headers are first-class list items with
 * their own recycler pool.
 */

import React, { useCallback, useMemo } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

import type { AgenticChatMessage, AgenticConversation } from '@/store/agenticChatStore';

import { ConversationRow } from './ConversationRow';
import { getConversationPreview } from './helpers';
import { drawerStyles as styles } from './styles/drawer';
import { headerStyles } from './styles/header';

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
  onArchiveConversation: (conversationId: string) => void;
  onUnarchiveConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
}

type DrawerListItem =
  | {
      kind: 'header';
      key: string;
      title: string;
      archived: boolean;
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
      archived: boolean;
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
  onArchiveConversation,
  onUnarchiveConversation,
  onDeleteConversation,
}: ChatHistoryDrawerProps): React.JSX.Element {
  const items = useMemo<DrawerListItem[]>(() => {
    const active = conversations.filter((conversation) => conversation.archivedAt == null);
    const archived = conversations.filter((conversation) => conversation.archivedAt != null);
    const list: DrawerListItem[] = [];

    list.push({ kind: 'header', key: 'recent-header', title: 'Recent', archived: false });
    if (active.length === 0) {
      list.push({ kind: 'empty', key: 'recent-empty', label: 'No chats yet' });
    } else {
      for (const conversation of active) {
        list.push({
          kind: 'row',
          key: `recent-${conversation.id}`,
          conversation,
          preview: getConversationPreview(conversation.id, messages),
          active: conversation.id === activeConversationId,
          archived: false,
        });
      }
    }

    list.push({ kind: 'header', key: 'archived-header', title: 'Archived chats', archived: true });
    if (archived.length === 0) {
      list.push({ kind: 'empty', key: 'archived-empty', label: 'No archived chats' });
    } else {
      for (const conversation of archived) {
        list.push({
          kind: 'row',
          key: `archived-${conversation.id}`,
          conversation,
          preview: getConversationPreview(conversation.id, messages),
          active: conversation.id === activeConversationId,
          archived: true,
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
              color={colors.text.secondary}
              style={styles.drawerSectionTitle}
            >
              {item.title}
            </Text>
            {item.archived ? (
              <Ionicons name="archive-outline" size={14} color={colors.text.tertiary} />
            ) : null}
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
          archived={item.archived}
          onOpen={() => onOpenConversation(item.conversation)}
          onArchive={() => onArchiveConversation(item.conversation.id)}
          onUnarchive={() => onUnarchiveConversation(item.conversation.id)}
          onDelete={() => onDeleteConversation(item.conversation.id)}
        />
      );
    },
    [onArchiveConversation, onDeleteConversation, onOpenConversation, onUnarchiveConversation],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable
          style={styles.drawerBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close chat history"
        />
        <View
          style={[
            styles.drawerPanel,
            {
              width,
              paddingTop: topInset + spacing.md,
              paddingBottom: Math.max(bottomInset, spacing.lg),
            },
          ]}
        >
          <View style={styles.drawerHeader}>
            <View style={styles.drawerTitleStack}>
              <Text variant="h3" color={colors.text.primary} style={styles.drawerTitle}>
                Chats
              </Text>
              <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                Local Yuga history
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.drawerIconButton,
                pressed && headerStyles.headerButtonPressed,
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
            style={({ pressed }) => [styles.newChatButton, pressed && styles.drawerRowPressed]}
            onPress={onNewChat}
            accessibilityRole="button"
            accessibilityLabel="Create new chat"
          >
            <Ionicons name="create-outline" size={19} color={colors.brand.deepShadow} />
            <Text variant="buttonSmall" color={colors.text.primary} style={styles.newChatLabel}>
              New chat
            </Text>
          </Pressable>

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
        </View>
      </View>
    </Modal>
  );
}
