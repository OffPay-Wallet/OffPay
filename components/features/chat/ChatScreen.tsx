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
  Keyboard,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { ConfirmDialogCard } from '@/components/ui/ConfirmDialogCard';
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
import { type AgenticConversation, useAgenticChatStore } from '@/store/agenticChatStore';
import { useAppStore } from '@/store/app';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import { ChatHeader } from './ChatHeader';
import { ChatHistoryDrawer } from './ChatHistoryDrawer';
import { ChatMessageList } from './ChatMessageList';
import { ChatPrivacyNote } from './ChatPrivacyNote';
import { ChatPromptDock } from './ChatPromptDock';
import { CHAT_DRAWER_MAX_WIDTH, PROMPT_HEIGHT } from './constants';
import { headerStyles } from './styles/header';
import { PayrollChatController } from '@/components/features/payroll/PayrollChatController';
import { PayrollColumnMapSheet } from '@/components/features/payroll/PayrollColumnMapSheet';
import { PayrollPasteSheet } from '@/components/features/payroll/PayrollPasteSheet';
import { usePayrollChatIntake } from '@/hooks/payroll/usePayrollChatIntake';
import { usePayrollResume } from '@/hooks/payroll/usePayrollResume';
import { useAgenticVoice } from '@/hooks/agentic-chat/useAgenticVoice';
import { useAgenticSpeech } from '@/hooks/agentic-chat/useAgenticSpeech';

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
  const deleteConversation = useAgenticChatStore((s) => s.deleteConversation);
  const updateMessage = useAgenticChatStore((s) => s.updateMessage);
  const updateAction = useAgenticChatStore((s) => s.updateAction);
  const createConversation = useAgenticChatStore((s) => s.createConversation);

  const { scope, scopeKey } = useAgenticChatScope();
  useAgenticPendingSweep(scope);

  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const avatarSize = dense ? 36 : compact ? 40 : 44;
  const displayName = username != null ? `@${username}` : (accountName ?? 'there');

  const [prompt, setPrompt] = useState('');
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [payrollPasteOpen, setPayrollPasteOpen] = useState(false);
  const [keyboardFrame, setKeyboardFrame] = useState<{ screenY: number } | null>(null);
  const [promptDockHeight, setPromptDockHeight] = useState(PROMPT_HEIGHT);
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string | null>(
    null,
  );
  // Declared early so the agent-submit callback can reach payroll intake
  // without a declaration-order cycle; assigned once intake is created.
  const payrollIntakeRef = useRef<ReturnType<typeof usePayrollChatIntake> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardOffset = useMemo(() => {
    if (keyboardFrame == null) return 0;
    return Math.max(0, windowHeight - keyboardFrame.screenY);
  }, [keyboardFrame, windowHeight]);
  const promptBottomInset = keyboardFrame == null ? insets.bottom : spacing.xs;
  // The composer is an overlay so the empty-state layout stays stable. Use the
  // measured dock height so multiline input and voice states never cover replies.
  const bottomPadding = keyboardOffset + promptDockHeight + spacing['2xl'];

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
      scopedConversations.find((conversation) => conversation.id === activeConversationId) ?? null,
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

  // Outcome read-aloud. Speaks short, sanitized status lines after a send or
  // payroll run resolves. Silent-fail and privacy-gated inside the hook.
  const speech = useAgenticSpeech();
  const activeWalletId = useWalletStore((s) => s.activeWalletId);

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
    walletId: activeWalletId,
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
    onSpeakOutcome: (phrase) => {
      void speech.speak(phrase);
    },
  });

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

  // Track only the keyboard overlap and move the bottom dock. Resizing the
  // whole screen makes the empty-state center jump when the composer focuses.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const handleShow = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardFrame({ screenY: event.endCoordinates.screenY });
    };
    const handleHide = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardFrame(null);
    };
    const showSub = Keyboard.addListener(showEvent, handleShow);
    const hideSub = Keyboard.addListener(hideEvent, handleHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardFrame == null) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardFrame, keyboardOffset]);

  useEffect(() => {
    if (scopedMessages.length === 0) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [promptDockHeight, scopedMessages.length]);

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

  const voice = useAgenticVoice({
    onTranscript: (transcript) => {
      if (agentBusy) {
        // Don't trample an in-flight turn; seed the input for the user.
        setPrompt(transcript);
        inputRef.current?.focus();
        return;
      }
      submit(transcript);
    },
    onError: (message) => {
      showToast({ title: 'Voice', message, variant: 'error' });
    },
  });

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
      setActiveConversation(scope, conversation.id);
      setChatDrawerOpen(false);
    },
    [scope, setActiveConversation],
  );

  const handleDeleteConversation = useCallback((id: string): void => {
    setPendingDeleteConversationId(id);
  }, []);

  const handleCancelDeleteConversation = useCallback((): void => {
    setPendingDeleteConversationId(null);
  }, []);

  const handleConfirmDeleteConversation = useCallback((): void => {
    if (pendingDeleteConversationId == null) return;

    const id = pendingDeleteConversationId;
    setPendingDeleteConversationId(null);
    deleteConversation(id);
    showToast({ title: 'Chat deleted', message: 'The chat was removed.', variant: 'info' });
  }, [deleteConversation, pendingDeleteConversationId, showToast]);

  const canSubmit = prompt.trim().length > 0 && !agentBusy;
  const handlePromptDockLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setPromptDockHeight((currentHeight) =>
      Math.abs(currentHeight - nextHeight) > 1 ? nextHeight : currentHeight,
    );
  }, []);

  return (
    <View style={headerStyles.container}>
      <ChatHeader
        topInset={insets.top}
        horizontalPadding={horizontalPadding}
        onBack={handleBack}
        onOpenHistory={() => setChatDrawerOpen(true)}
      />

      <View style={headerStyles.chatBody}>
        <ScrollView
          ref={scrollRef}
          style={headerStyles.chatScroll}
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
            <View
              style={[
                headerStyles.welcomeAvatar,
                { width: avatarSize + 12, height: avatarSize + 12 },
              ]}
            >
              <WalletAvatar size={avatarSize} solidFill />
            </View>
            <View style={headerStyles.welcomeText}>
              <Text
                color={colors.text.secondary}
                style={headerStyles.welcomeEyebrow}
                numberOfLines={1}
              >
                Hey there
              </Text>
              <Text
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
                onRefreshRoutes={
                  payrollIntake.activeRunId != null ? payrollIntake.refreshRoutes : undefined
                }
                onSpeakOutcome={(phrase) => {
                  void speech.speak(phrase, { payrollMode: true });
                }}
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

          {scopedMessages.length > 0 ? <View style={headerStyles.messageBottomAnchor} /> : null}

          {scopedMessages.length > 0 ? (
            <ChatMessageList
              messages={scopedMessages}
              actionsById={actionsById}
              onConfirmPrivateSend={(action) => {
                void confirmPrivateSend(action);
              }}
              onCancelPrivateSend={cancelPrivateSend}
            />
          ) : null}
        </ScrollView>

        {scopedMessages.length === 0 ? (
          <ChatPrivacyNote horizontalPadding={horizontalPadding} />
        ) : null}
      </View>

      <ChatPromptDock
        inputRef={inputRef}
        prompt={prompt}
        busy={agentBusy}
        canSubmit={canSubmit}
        bottomInset={promptBottomInset}
        keyboardOffset={keyboardOffset}
        horizontalPadding={horizontalPadding}
        onLayout={handlePromptDockLayout}
        onChangeText={setPrompt}
        onSubmit={handleSubmit}
        onUpload={() => {
          void payrollIntake.pickFile();
        }}
        onUploadLongPress={() => setPayrollPasteOpen(true)}
        onPastePayroll={() => setPayrollPasteOpen(true)}
        uploadBusy={payrollIntake.busy}
        voice={{
          state: voice.state,
          transcript: voice.transcript,
          level: voice.level,
          onPress: () => {
            if (voice.state === 'idle') speech.stop();
            voice.toggle();
          },
          onAccept: voice.accept,
          onCancel: voice.cancel,
        }}
        speech={{
          state: speech.state,
          muted: speech.muted,
          onStop: speech.stop,
          onToggleMuted: speech.toggleMuted,
        }}
      />

      <PayrollPasteSheet
        visible={payrollPasteOpen}
        busy={payrollIntake.busy}
        error={payrollIntake.error}
        onClose={() => setPayrollPasteOpen(false)}
        onSubmit={async (fileName, text) => {
          const result = await payrollIntake.stageFromText(fileName, text);
          if (result.status === 'staged' || result.status === 'mapping_required') {
            setPayrollPasteOpen(false);
            return true;
          }
          return false;
        }}
      />

      {payrollIntake.mappingRequest != null ? (
        <PayrollColumnMapSheet
          visible
          busy={payrollIntake.busy}
          headers={payrollIntake.mappingRequest.headers}
          sampleRows={payrollIntake.mappingRequest.sampleRows}
          suggestedMapping={payrollIntake.mappingRequest.suggestedMapping}
          onClose={payrollIntake.cancelMapping}
          onSubmit={(mapping) => {
            void payrollIntake.stageWithMapping(mapping);
          }}
        />
      ) : null}

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
        onDeleteConversation={handleDeleteConversation}
      />

      <ConfirmDialogCard
        visible={pendingDeleteConversationId != null}
        title="Delete chat?"
        message="This removes the chat from this device."
        confirmLabel="Delete"
        destructive
        onCancel={handleCancelDeleteConversation}
        onConfirm={handleConfirmDeleteConversation}
      />
    </View>
  );
}
