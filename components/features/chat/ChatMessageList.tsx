/**
 * Renders the scrollable message list for an active conversation. Empty
 * state (action tiles + intro) is rendered by the parent screen so this
 * file stays focused on bubble rendering.
 */

import React from 'react';
import { View } from 'react-native';

import type {
  AgenticChatAction,
  AgenticChatMessage,
  AgenticPrivateSendAction,
} from '@/store/agenticChatStore';
import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollOutcomeAnnouncement } from '@/components/features/payroll/PayrollChatController';
import type { PayrollRoutePolicy } from '@/lib/payroll/payroll-types';

import { ChatMessageBubble } from './ChatMessageBubble';
import { messageStyles as styles } from './styles/message';

interface ChatMessageListProps {
  messages: readonly AgenticChatMessage[];
  actionsById: ReadonlyMap<string, AgenticChatAction>;
  onConfirmPrivateSend: (action: AgenticChatAction) => void;
  onCancelPrivateSend: (action: AgenticChatAction) => void;
  onChangePrivateSendRoute: (
    action: AgenticPrivateSendAction,
    route: AgenticPrivateSendAction['route'],
  ) => void;
  activePayrollRunId?: string | null;
  walletId: string | null;
  payrollSummary: PayrollConfirmationSummary | null;
  payrollSetupBusy?: boolean;
  onSetupPayrollUmbra?: () => void;
  onRefreshPayrollRoutes?: () => Promise<void>;
  onPayrollRoutePolicyChange?: (policy: PayrollRoutePolicy) => void;
  onSpeakPayrollOutcome?: (phrase: string) => void;
  onAnnouncePayrollOutcome?: (outcome: PayrollOutcomeAnnouncement) => void;
}

function ChatMessageListComponent({
  messages,
  actionsById,
  onConfirmPrivateSend,
  onCancelPrivateSend,
  onChangePrivateSendRoute,
  activePayrollRunId,
  walletId,
  payrollSummary,
  payrollSetupBusy,
  onSetupPayrollUmbra,
  onRefreshPayrollRoutes,
  onPayrollRoutePolicyChange,
  onSpeakPayrollOutcome,
  onAnnouncePayrollOutcome,
}: ChatMessageListProps): React.JSX.Element {
  return (
    <View style={styles.messageList}>
      {messages.map((message) => (
        <ChatMessageBubble
          key={message.id}
          message={message}
          action={message.actionId != null ? actionsById.get(message.actionId) : undefined}
          onConfirmPrivateSend={onConfirmPrivateSend}
          onCancelPrivateSend={onCancelPrivateSend}
          onChangePrivateSendRoute={onChangePrivateSendRoute}
          activePayrollRunId={activePayrollRunId}
          walletId={walletId}
          payrollSummary={payrollSummary}
          payrollSetupBusy={payrollSetupBusy}
          onSetupPayrollUmbra={onSetupPayrollUmbra}
          onRefreshPayrollRoutes={onRefreshPayrollRoutes}
          onPayrollRoutePolicyChange={onPayrollRoutePolicyChange}
          onSpeakPayrollOutcome={onSpeakPayrollOutcome}
          onAnnouncePayrollOutcome={onAnnouncePayrollOutcome}
        />
      ))}
    </View>
  );
}

export const ChatMessageList = React.memo(ChatMessageListComponent);
