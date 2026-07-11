import React from 'react';

import type {
  AgenticChatAction,
  AgenticAdvancedSwapAction,
  AgenticAdvancedSwapCancelAction,
  AgenticFlashDepositAction,
  AgenticFlashPositionAction,
  AgenticPrivateSendAction,
  AgenticRwaTradeAction,
  AgenticSwapAction,
  AgenticUmbraClaimAction,
  AgenticUmbraVaultAction,
} from '@/store/agenticChatStore';

import { FlashPositionConfirmationCard } from './FlashPositionConfirmationCard';
import { AdvancedSwapConfirmationCard } from './AdvancedSwapConfirmationCard';
import { FlashDepositConfirmationCard } from './FlashDepositConfirmationCard';
import { PrivateSendConfirmationCard } from './PrivateSendConfirmationCard';
import { RwaTradeConfirmationCard } from './RwaTradeConfirmationCard';
import { SwapConfirmationCard } from './SwapConfirmationCard';
import { UmbraClaimConfirmationCard } from './UmbraClaimConfirmationCard';
import { UmbraVaultConfirmationCard } from './UmbraVaultConfirmationCard';

export type AgenticTransactionAction =
  | AgenticPrivateSendAction
  | AgenticUmbraVaultAction
  | AgenticUmbraClaimAction
  | AgenticSwapAction
  | AgenticAdvancedSwapAction
  | AgenticAdvancedSwapCancelAction
  | AgenticRwaTradeAction
  | AgenticFlashDepositAction
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
      action.kind === 'umbra_vault' ||
      action.kind === 'umbra_claim' ||
      action.kind === 'swap' ||
      action.kind === 'swap_trigger' ||
      action.kind === 'swap_recurring' ||
      action.kind === 'swap_trigger_cancel' ||
      action.kind === 'swap_recurring_cancel' ||
      action.kind === 'rwa_trade' ||
      action.kind === 'flash_deposit' ||
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

  if (
    action.kind === 'swap_trigger' ||
    action.kind === 'swap_recurring' ||
    action.kind === 'swap_trigger_cancel' ||
    action.kind === 'swap_recurring_cancel'
  ) {
    return (
      <AdvancedSwapConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />
    );
  }

  if (action.kind === 'rwa_trade') {
    return <RwaTradeConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
  }

  if (action.kind === 'flash_position') {
    return (
      <FlashPositionConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />
    );
  }

  if (action.kind === 'flash_deposit') {
    return (
      <FlashDepositConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />
    );
  }

  if (action.kind === 'umbra_vault') {
    return <UmbraVaultConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
  }

  if (action.kind === 'umbra_claim') {
    return <UmbraClaimConfirmationCard action={action} onConfirm={onConfirm} onCancel={onCancel} />;
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
