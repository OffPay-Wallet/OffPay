import { analyzeAgenticWallet } from '@/lib/agentic-payments/wallet-analyzer';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

export const analyzeWalletTool: AgenticToolDefinition = {
  name: 'analyze_wallet',
  schema: {
    name: 'analyze_wallet',
    description:
      'Returns wallet details/readiness labels: gas readiness, private-route readiness, stablecoin availability, and unverified-token warnings. Does not read or send transaction history.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    const analysis = analyzeAgenticWallet({
      walletAddress: context.scope.walletAddress,
      walletMode: context.walletMode,
      canUseNetwork: context.canUseNetwork,
      balance: context.balance,
      capabilities: context.capabilities,
    });
    return {
      result: {
        status: 'ok',
        details: analysis.insights.map((insight) => ({
          id: insight.id,
          severity: insight.severity,
        })),
        usesTransactionHistory: false,
      },
    };
  },
};
