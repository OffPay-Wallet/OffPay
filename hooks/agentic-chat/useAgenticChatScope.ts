/**
 * Reads the current chat scope (active wallet + network) from the wallet
 * and preferences stores. Returns a stable object plus its scope key so
 * memoized consumers can compare cheaply.
 */

import { useMemo } from 'react';

import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  getAgenticConversationScopeKey,
  type AgenticChatScope,
} from '@/store/agenticChatStore';
import { useWalletStore } from '@/store/walletStore';

export interface AgenticChatScopeState {
  scope: AgenticChatScope;
  scopeKey: string;
}

export function useAgenticChatScope(): AgenticChatScopeState {
  const walletAddress = useWalletStore((s) => s.publicKey);
  const { network } = useOffpayNetwork();

  return useMemo(() => {
    const scope: AgenticChatScope = { walletAddress, network };
    return { scope, scopeKey: getAgenticConversationScopeKey(scope) };
  }, [network, walletAddress]);
}
