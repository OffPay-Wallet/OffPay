import React from 'react';

import type {
  AgenticChatAction,
  AgenticFlashPositionAction,
  AgenticPrivateSendAction,
  AgenticSwapAction,
} from '@/store/agenticChatStore';

import { FlashPositionConfirmationCard } from './FlashPositionConfirmationCard';
import { PrivateSendConfirmationCard } from './PrivateSendConfirmationCard';
import { SwapConfirmationCard } from './SwapConfirmationCard';

export type AgenticTransactionAction =
  | AgenticPrivateSendAction
  | AgenticSwapAction
  | AgenticFlashPositionAction;

interface AgenticActionCardProps {
  action: AgenticTransactionAction;
  onConfirm: (action: AgenticChatAction) => void;
  onCancel: (action: AgenticChatAction) => void;
  onRouteChange: (
    action: AgenticPrivateSendAction,
    route: AgenticPrivateSendAction['route'],
  ) => void;
}

export function isAgenticTransactionAction(
  action: AgenticChatAction | null | undefined,
): action is AgenticTransactionAction {
  return (
    action != null &&
    (action.kind === 'private_send' ||
      action.kind === 'normal_send' ||
      action.kind === 'swap' ||
      action.kind === 'flash_position')
  );
}

export function isAgenticDraftSheetAction(
  action: AgenticChatAction | null | undefined,
): action is AgenticTransactionAction {
  return (
    isAgenticTransactionAction(action) &&
    (action.status === 'needs_confirmation' || action.status === 'submitting')
  );
}

export function AgenticActionCard({
  action,
  onConfirm,
  onCancel,
  onRouteChange,
}: AgenticActionCardProps): React.JSX.Element {
  if (action.kind === 'swap') {
    return <SwapConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
  }

  if (action.kind === 'flash_position') {
    return (
      <FlashPositionConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />
    );
  }

  return (
    <PrivateSendConfirmationCard
      action={action}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onRouteChange={onRouteChange}
    />
  );
}
