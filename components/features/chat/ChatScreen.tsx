/**
 * Yuga chat home — entry point for the agentic payments experience.
 *
 * Layout + conversation-store wiring only. Heavy logic lives in the
 * `useAgenticAgentSubmit`, `useAgenticConfirmSend`,
 * `useAgenticPendingSweep`, and `useAgenticChatScope` hooks.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { useAppToast } from '@/components/ui/AppToast';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { useAgenticAgentSubmit } from '@/hooks/agentic-chat/useAgenticAgentSubmit';
import { useAgenticChatScope } from '@/hooks/agentic-chat/useAgenticChatScope';
import { useAgenticConfirmSend } from '@/hooks/agentic-chat/useAgenticConfirmSend';
import { useAgenticPendingSweep } from '@/hooks/agentic-chat/useAgenticPendingSweep';
import { useUmbraExecution } from '@/hooks/useUmbraExecution';
import { buildAgentWalletBalanceResponse } from '@/lib/agentic-payments/safe-context';
import {
  type AgenticConversation,
  useAgenticChatStore,
} from '@/store/agenticChatStore';
import { useAppStore } from '@/store/app';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import { ChatHeader } from './ChatHeader';
import { ChatHistoryDrawer } from './ChatHistoryDrawer';
import { ChatMessageList } from './ChatMessageList';
import { ChatPromptDock } from './ChatPromptDock';
import { ChatSuggestions, type ChatSuggestion } from './ChatSuggestions';
import { CHAT_DRAWER_MAX_WIDTH, PROMPT_HEIGHT } from './constants';
import { headerStyles } from './styles/header';
import { PayrollChatController } from '@/components/features/payroll/PayrollChatController';
import { PayrollPasteSheet } from '@/components/features/payroll/PayrollPasteSheet';
import { usePayrollChatIntake } from '@/hooks/payroll/usePayrollChatIntake';
import { usePayrollResume } from '@/hooks/payroll/usePayrollResume';

export function ChatScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);
  const { showToast } = useAppToast();

  const username = useAppStore((s) => s.username);
  const accountName = useWalletStore((s) => s.accountName);
  const wallets = useWalletStore((s) => s.wallets);

  const { effectiveWalletMode, canUseNetwork } = useWalletModeState();
  const { mixerRegisterMutation } = useUmbraExecution();
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: false,
    eagerWithoutCapabilities: true,
  });

  const messages = useAgenticChatStore((s) => s.messages);
  const actions = useAgenticChatStore((s) => s.actions);
  const conversations = useAgenticChatStore((s) => s.conversations);
  const activeConversationIdByScope = useAgenticChatStore((s) => s.activeConversationIdByScope);
  const setActiveConversation = useAgenticChatStore((s) => s.setActiveConversation);
  const archiveConversation = useAgenticChatStore((s) => s.archiveConversation);
  const unarchiveConversation = useAgenticChatStore((s) => s.unarchiveConversation);
  const deleteConversation = useAgenticChatStore((s) => s.deleteConversation);
  const updateMessage = useAgenticChatStore((s) => s.updateMessage);
  const updateAction = useAgenticChatStore((s) => s.updateAction);
  const createConversation = useAgenticChatStore((s) => s.createConversation);

  const { scope, scopeKey } = useAgenticChatScope();
  useAgenticPendingSweep(scope);

  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + PROMPT_HEIGHT + spacing['2xl'];
  const avatarSize = dense ? 36 : compact ? 40 : 44;
  const displayName = username != null ? `@${username}` : (accountName ?? 'there');

  const [prompt, setPrompt] = useState('');
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [payrollPasteOpen, setPayrollPasteOpen] = useState(false);
  // Declared early so the agent-submit callback can reach payroll intake
  // without a declaration-order cycle; assigned once intake is created.
  const payrollIntakeRef = useRef<ReturnType<typeof usePayrollChatIntake> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const activeConversationId = activeConversationIdByScope[scopeKey] ?? null;
  const scopedConversations = useMemo(
    () =>
      conversations
        .filter(
          (conversation) =>
            conversation.walletAddress === scope.walletAddress &&
            conversation.network === scope.network,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [conversations, scope.network, scope.walletAddress],
  );
  const activeConversation = useMemo(
    () =>
      scopedConversations.find(
        (conversation) =>
          conversation.id === activeConversationId && conversation.archivedAt == null,
      ) ?? null,
    [activeConversationId, scopedConversations],
  );
  const scopedMessages = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.walletAddress === scope.walletAddress &&
            message.network === scope.network &&
            message.conversationId === activeConversation?.id,
        )
        .sort((left, right) => left.createdAt - right.createdAt),
    [activeConversation?.id, messages, scope.network, scope.walletAddress],
  );
  const actionsById = useMemo(() => {
    const byId = new Map<string, (typeof actions)[number]>();
    for (const action of actions) byId.set(action.id, action);
    return byId;
  }, [actions]);

  const knownWallets = useMemo(
    () =>
      wallets.map((wallet) => ({
        name: wallet.name,
        address: wallet.publicKey,
        active: wallet.publicKey === scope.walletAddress,
      })),
    [scope.walletAddress, wallets],
  );
  const agentBalance = useMemo(
    () =>
      balanceQuery.data == null
        ? balanceQuery.data
        : buildAgentWalletBalanceResponse(balanceQuery.data, capabilitiesQuery.capabilities),
    [balanceQuery.data, capabilitiesQuery.capabilities],
  );

  const { submit, busy: agentBusy } = useAgenticAgentSubmit({
    scope,
    scopeKey,
    activeConversationId: activeConversation?.id ?? null,
    scopedMessages,
    walletMode: effectiveWalletMode,
    canUseNetwork,
    balance: agentBalance,
    capabilities: capabilitiesQuery.capabilities,
    knownWallets,
    onPayrollIntent: (source) => {
      if (source === 'upload') {
        void payrollIntakeRef.current?.pickFile();
      } else {
        setPayrollPasteOpen(true);
      }
    },
  });

  const { confirm: confirmPrivateSend, cancel: cancelPrivateSend } = useAgenticConfirmSend({
    scope,
    walletMode: effectiveWalletMode,
    canUseNetwork,
    balance: agentBalance,
    capabilities: capabilitiesQuery.capabilities,
    knownWallets,
  });

  const activeWalletId = useWalletStore((s) => s.activeWalletId);
  const activeImportMethod = useMemo(() => {
    const active = wallets.find((wallet) => wallet.publicKey === scope.walletAddress);
    return active?.importMethod ?? null;
  }, [wallets, scope.walletAddress]);

  const payrollIntake = usePayrollChatIntake({
    walletAddress: scope.walletAddress,
    walletId: activeWalletId,
    network: scope.network,
    importMethod: activeImportMethod,
    balance: balanceQuery.data,
    capabilities: capabilitiesQuery.capabilities,
    canUseNetwork,
  });
  // Ref so the agent-submit callback (declared earlier) can trigger intake
  // without a declaration-order cycle.
  payrollIntakeRef.current = payrollIntake;

  const payrollResume = usePayrollResume({
    walletAddress: scope.walletAddress,
    network: scope.network,
  });
  // Prefer an actively-staged run; otherwise offer the most recent resumable
  // run recovered from a prior session.
  const activePayrollRunId = payrollIntake.activeRunId ?? payrollResume.resumableRunId;

  const handleSetupUmbraForPayroll = useCallback(async () => {
    if (scope.walletAddress == null || scope.network == null) {
      Alert.alert('Connect a wallet', 'Connect a wallet before setting up Umbra payroll.');
      return;
    }
    try {
      await mixerRegisterMutation.mutateAsync({
        walletAddress: scope.walletAddress,
        walletId: activeWalletId,
        network: scope.network,
      });
      await payrollIntake.refreshRoutes();
      showToast({
        title: 'Umbra setup complete',
        message: 'Payroll routes were refreshed.',
        variant: 'success',
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Umbra setup failed.';
      Alert.alert('Umbra setup failed', message);
    }
  }, [
    activeWalletId,
    mixerRegisterMutation,
    payrollIntake,
    scope.network,
    scope.walletAddress,
    showToast,
  ]);

  // Migrate legacy messages with a missing `conversationId` once.
  useEffect(() => {
    const legacy = messages.filter(
      (message) =>
        message.walletAddress === scope.walletAddress &&
        message.network === scope.network &&
        message.conversationId == null,
    );
    if (legacy.length === 0) return;
    const firstUserText =
      legacy
        .slice()
        .sort((left, right) => left.createdAt - right.createdAt)
        .find((message) => message.role === 'user')?.text ?? 'Previous chat';
    const conversationId = createConversation(scope, firstUserText);
    for (const message of legacy) {
      updateMessage(message.id, { conversationId });
      if (message.actionId != null) {
        updateAction(message.actionId, { conversationId });
      }
    }
  }, [createConversation, messages, scope, updateAction, updateMessage]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || agentBusy) return;
    setPrompt('');
    submit(trimmed);
  }, [agentBusy, prompt, submit]);

  const handlePickSuggestion = useCallback(
    (suggestion: ChatSuggestion) => {
      if (agentBusy) {
        // Don't trample an in-flight request. Seed the input so the user
        // can send it once the current turn lands.
        setPrompt(suggestion.prompt);
        inputRef.current?.focus();
        return;
      }
      setPrompt('');
      submit(suggestion.prompt);
    },
    [agentBusy, submit],
  );

  const handleBack = useCallback(() => {
    const target =
      previousRoute !== 'index' && previousRoute !== 'chat'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  }, [previousRoute, router]);

  const handleNewChat = useCallback(() => {
    setPrompt('');
    setActiveConversation(scope, null);
    setChatDrawerOpen(false);
  }, [scope, setActiveConversation]);

  const handleOpenConversation = useCallback(
    (conversation: AgenticConversation) => {
      if (conversation.archivedAt != null) {
        unarchiveConversation(conversation.id);
      } else {
        setActiveConversation(scope, conversation.id);
      }
      setChatDrawerOpen(false);
    },
    [scope, setActiveConversation, unarchiveConversation],
  );

  const handleArchiveConversation = useCallback(
    (id: string) => {
      archiveConversation(id);
      showToast({
        title: 'Chat archived',
        message: 'You can find it under Archived chats.',
        variant: 'success',
      });
    },
    [archiveConversation, showToast],
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      Alert.alert('Delete chat?', 'This removes the chat from this device.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteConversation(id);
            showToast({ title: 'Chat deleted', message: 'The chat was removed.', variant: 'info' });
          },
        },
      ]);
    },
    [deleteConversation, showToast],
  );

  const canSubmit = prompt.trim().length > 0 && !agentBusy;

  return (
    <KeyboardAvoidingView
      style={headerStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ChatHeader
        topInset={insets.top}
        horizontalPadding={horizontalPadding}
        onBack={handleBack}
        onOpenHistory={() => setChatDrawerOpen(true)}
      />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          headerStyles.scrollContent,
          { paddingHorizontal: horizontalPadding, paddingBottom: bottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={headerStyles.welcomeRow}>
          <View style={[headerStyles.welcomeAvatar, { width: avatarSize + 12, height: avatarSize + 12 }]}>
            <WalletAvatar size={avatarSize} solidFill />
          </View>
          <View style={headerStyles.welcomeText}>
            <Text
              variant="caption"
              color={colors.text.secondary}
              style={headerStyles.welcomeEyebrow}
              numberOfLines={1}
            >
              Hey there
            </Text>
            <Text
              variant="h2"
              color={colors.text.primary}
              style={headerStyles.welcomeName}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              maxFontSizeMultiplier={1.05}
            >
              {displayName}
            </Text>
          </View>
        </View>

        {activePayrollRunId != null ? (
          <View style={{ paddingHorizontal: horizontalPadding, paddingBottom: spacing.lg }}>
            <PayrollChatController
              runId={activePayrollRunId}
              walletId={activeWalletId}
              summary={payrollIntake.activeRunId != null ? payrollIntake.summary : null}
              onSetupUmbra={handleSetupUmbraForPayroll}
              setupBusy={mixerRegisterMutation.isPending}
            />
          </View>
        ) : null}

        {payrollIntake.error != null ? (
          <View style={{ paddingHorizontal: horizontalPadding, paddingBottom: spacing.sm }}>
            <Text variant="caption" color={colors.semantic.error}>
              {payrollIntake.error}
            </Text>
          </View>
        ) : null}

        {scopedMessages.length === 0 ? (
          <ChatSuggestions onPickSuggestion={handlePickSuggestion} />
        ) : (
          <ChatMessageList
            messages={scopedMessages}
            actionsById={actionsById}
            onConfirmPrivateSend={(action) => {
              void confirmPrivateSend(action);
            }}
            onCancelPrivateSend={cancelPrivateSend}
          />
        )}
      </ScrollView>

      <ChatPromptDock
        inputRef={inputRef}
        prompt={prompt}
        busy={agentBusy}
        canSubmit={canSubmit}
        bottomInset={insets.bottom}
        horizontalPadding={horizontalPadding}
        onChangeText={setPrompt}
        onSubmit={handleSubmit}
        onUpload={() => {
          void payrollIntake.pickFile();
        }}
        onUploadLongPress={() => setPayrollPasteOpen(true)}
        uploadBusy={payrollIntake.busy}
      />

      <PayrollPasteSheet
        visible={payrollPasteOpen}
        busy={payrollIntake.busy}
        onClose={() => setPayrollPasteOpen(false)}
        onSubmit={(fileName, text) => {
          setPayrollPasteOpen(false);
          void payrollIntake.stageFromText(fileName, text);
        }}
      />

      <ChatHistoryDrawer
        visible={chatDrawerOpen}
        conversations={scopedConversations}
        messages={messages}
        activeConversationId={activeConversation?.id ?? null}
        width={Math.min(CHAT_DRAWER_MAX_WIDTH, Math.round(windowWidth * 0.88))}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onClose={() => setChatDrawerOpen(false)}
        onNewChat={handleNewChat}
        onOpenConversation={handleOpenConversation}
        onArchiveConversation={handleArchiveConversation}
        onUnarchiveConversation={(id) => {
          unarchiveConversation(id);
          setChatDrawerOpen(false);
        }}
        onDeleteConversation={handleDeleteConversation}
      />
    </KeyboardAvoidingView>
  );
}
