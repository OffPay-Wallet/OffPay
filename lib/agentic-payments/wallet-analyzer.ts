import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { buildVisibleTokenHoldings, formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';

import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

export type WalletAnalyzerInsightId =
  | 'wallet_not_connected'
  | 'network_unavailable'
  | 'offline_mode'
  | 'gas_empty'
  | 'gas_low'
  | 'gas_ready'
  | 'private_send_ready'
  | 'private_send_unavailable'
  | 'stablecoin_ready'
  | 'unknown_tokens_present'
  | 'wallet_balance_loading';

export interface WalletAnalyzerInsight {
  id: WalletAnalyzerInsightId;
  severity: 'info' | 'warning' | 'good';
  title: string;
  detail: string;
}

export interface WalletAnalyzerResult {
  insights: WalletAnalyzerInsight[];
  aiSafeLabels: WalletAnalyzerInsightId[];
  summaryText: string;
}

interface AnalyzeWalletParams {
  walletAddress: string | null;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
}

const LOW_GAS_SOL = 0.02;
const LAMPORTS_PER_SOL = 1_000_000_000;

export function analyzeAgenticWallet(params: AnalyzeWalletParams): WalletAnalyzerResult {
  const insights: WalletAnalyzerInsight[] = [];

  if (params.walletAddress == null) {
    insights.push({
      id: 'wallet_not_connected',
      severity: 'warning',
      title: 'Wallet not connected',
      detail: 'Connect a wallet before Yuga can draft or confirm transfers.',
    });
    return buildResult(insights);
  }

  if (!params.canUseNetwork) {
    insights.push({
      id: 'network_unavailable',
      severity: 'warning',
      title: 'Network unavailable',
      detail: 'Switch to online mode before confirming network transfers.',
    });
  }

  if (params.walletMode !== 'online') {
    insights.push({
      id: 'offline_mode',
      severity: 'info',
      title: 'Offline mode',
      detail: 'Yuga can explain wallet state, but transfers need online mode.',
    });
  }

  if (params.balance == null) {
    insights.push({
      id: 'wallet_balance_loading',
      severity: 'info',
      title: 'Wallet balance loading',
      detail: 'Wait for balances to load before asking Yuga to draft a transfer.',
    });
    return buildResult(insights);
  }

  const sol = params.balance.solBalance / LAMPORTS_PER_SOL;
  if (sol <= 0) {
    insights.push({
      id: 'gas_empty',
      severity: 'warning',
      title: 'No SOL for fees',
      detail: 'Add SOL before sending tokens or using private routes.',
    });
  } else if (sol < LOW_GAS_SOL) {
    insights.push({
      id: 'gas_low',
      severity: 'warning',
      title: 'Low SOL for fees',
      detail: `You have ${formatLamportsAsSol(params.balance.solBalance, 5)} SOL available for fees.`,
    });
  } else {
    insights.push({
      id: 'gas_ready',
      severity: 'good',
      title: 'SOL ready',
      detail: `You have ${formatLamportsAsSol(params.balance.solBalance, 5)} SOL available for fees.`,
    });
  }

  const privateReady =
    isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.privateInitMint') &&
    isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.privateSend') &&
    isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast');

  insights.push(
    privateReady
      ? {
          id: 'private_send_ready',
          severity: 'good',
          title: 'Private send ready',
          detail: 'The current network supports Yuga private sends.',
        }
      : {
          id: 'private_send_unavailable',
          severity: 'warning',
          title: 'Private send unavailable',
          detail: 'Private send is not available on the current network or capability set.',
        },
  );

  const holdings = buildVisibleTokenHoldings(params.balance);
  const stablecoins = holdings.filter((holding) => /^(d?usdc|d?usdt)$/i.test(holding.symbol));
  if (stablecoins.length > 0) {
    insights.push({
      id: 'stablecoin_ready',
      severity: 'good',
      title: 'Stablecoin balance available',
      detail: `${stablecoins.length} stablecoin balance${stablecoins.length === 1 ? '' : 's'} can be used for payment drafts.`,
    });
  }

  const unknownTokens = params.balance.tokens.filter(
    (token) => token.symbol === token.mint || token.name === token.mint || token.verified === false,
  );
  if (unknownTokens.length > 0) {
    insights.push({
      id: 'unknown_tokens_present',
      severity: 'info',
      title: 'Unverified token rows present',
      detail: `${unknownTokens.length} token row${unknownTokens.length === 1 ? '' : 's'} may need extra review before use.`,
    });
  }

  return buildResult(insights);
}

function buildResult(insights: WalletAnalyzerInsight[]): WalletAnalyzerResult {
  return {
    insights,
    aiSafeLabels: insights.map((insight) => insight.id),
    summaryText: formatWalletAnalyzerSummary(insights),
  };
}

function formatWalletAnalyzerSummary(insights: readonly WalletAnalyzerInsight[]): string {
  if (insights.length === 0) {
    return 'I do not see any wallet tips right now.';
  }

  return insights
    .map((insight) => `${insight.title}: ${insight.detail}`)
    .join('\n');
}
