import { Platform } from 'react-native';

import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { fetchUmbraEncryptedBalances } from '@/lib/umbra/umbra-execution';
import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import {
  getUmbraSupportedTokens,
  isUmbraNetworkSupported,
  resolveUmbraSupportedToken,
} from '@/lib/umbra/umbra-supported-tokens';
import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';
import { walletCanSignWithApp } from '@/lib/wallet/wallet-capabilities';

import { hydrateStringArg, readStringArg, requireWalletAndNetwork } from './helpers';
import type { AgenticToolDefinition, AgenticToolRunnerContext } from './types';

import type { AgentToolCall } from '@/lib/agentic-payments/types';
import type { UmbraEncryptedBalanceSummary } from '@/lib/umbra/umbra-execution';
import type { UmbraSupportedToken } from '@/lib/umbra/umbra-supported-tokens';
import type { AgenticUmbraVaultOperation } from '@/store/agenticChatStore';
import type { OffpayNetwork, WalletBalanceResponse } from '@/types/offpay-api';

type VaultOperationArg = AgenticUmbraVaultOperation | 'withdraw' | 'auto';

const DEFAULT_UMBRA_VAULT_TOKENS = ['USDC', 'USDT', 'dUSDC', 'dUSDT', 'wSOL'] as const;

function isPositiveRawAmount(value: string | null): value is string {
  if (value == null || !/^\d+$/.test(value)) return false;
  return BigInt(value) > 0n;
}

function rawAmountFitsBalance(rawAmount: string, balanceRaw: string | null): boolean {
  if (balanceRaw == null || !/^\d+$/.test(balanceRaw)) return false;
  return BigInt(rawAmount) <= BigInt(balanceRaw);
}

function inferVaultOperation(userText: string): AgenticUmbraVaultOperation | null {
  const turns = userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0)
    .reverse();

  for (const turn of turns) {
    if (
      /\b(?:withdraw|unshield|decrypt|release|move)\b.*\b(?:public|wallet|balance)\b/i.test(turn) ||
      /\b(?:from|out\s+of)\s+(?:my\s+)?(?:umbra\s+)?vault\b/i.test(turn)
    ) {
      return 'unshield';
    }
    if (
      /\b(?:shield|encrypt|deposit|lock)\b/i.test(turn) ||
      /\b(?:into|to)\s+(?:my\s+)?(?:umbra\s+)?vault\b/i.test(turn)
    ) {
      return 'shield';
    }
  }

  return null;
}

function readVaultOperation(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
): AgenticUmbraVaultOperation | null {
  const raw = readStringArg(call, 'operation')?.toLowerCase() as VaultOperationArg | undefined;
  if (raw === 'shield') return 'shield';
  if (raw === 'unshield' || raw === 'withdraw') return 'unshield';
  return inferVaultOperation(context.userText);
}

function buildTokenAlternation(context: AgenticToolRunnerContext): string {
  const symbols = new Set<string>(DEFAULT_UMBRA_VAULT_TOKENS);
  for (const token of context.balance?.tokens ?? []) {
    if (token.symbol.trim().length > 0) symbols.add(token.symbol.trim());
  }
  if (context.scope.network != null) {
    for (const token of getUmbraSupportedTokens(context.scope.network)) {
      symbols.add(token.symbol);
      for (const alias of token.aliases ?? []) symbols.add(alias);
    }
  }
  return [...symbols]
    .filter((symbol) => symbol.trim().length > 0)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map((symbol) => symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

function inferAmountFromText(context: AgenticToolRunnerContext): string {
  const alternation = buildTokenAlternation(context);
  if (alternation.length === 0) return '';
  const regex = new RegExp(
    `(?<![A-Za-z0-9.])(\\d+(?:\\.\\d+)?)\\s*(?:${alternation})(?![A-Za-z0-9])`,
    'i',
  );
  const turns = context.userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0)
    .reverse();
  for (const turn of turns) {
    const match = regex.exec(turn);
    if (match?.[1] != null) return match[1];
  }
  return '';
}

function inferTokenFromText(context: AgenticToolRunnerContext): string {
  const alternation = buildTokenAlternation(context);
  if (alternation.length === 0) return '';
  const regex = new RegExp(`(?<![A-Za-z0-9])(${alternation})(?![A-Za-z0-9])`, 'i');
  const turns = context.userText
    .split('\n')
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0)
    .reverse();
  for (const turn of turns) {
    const match = regex.exec(turn);
    if (match?.[1] != null) return match[1];
  }
  return '';
}

function getUmbraVaultActionReadiness(
  context: AgenticToolRunnerContext,
): { ok: true } | { ok: false; code: string } {
  const network = context.scope.network;
  if (network == null) return { ok: false, code: 'network_not_selected' };
  if (!isUmbraNetworkSupported(network)) return { ok: false, code: 'feature_unavailable' };
  if (context.walletMode !== 'online' || !context.canUseNetwork) {
    return { ok: false, code: 'requires_online_mode' };
  }
  if (context.walletId == null) return { ok: false, code: 'wallet_locked' };
  if (
    !walletCanSignWithApp({
      importMethod: context.walletImportMethod,
      walletAddress: context.scope.walletAddress,
    })
  ) {
    return { ok: false, code: 'wallet_cannot_sign' };
  }
  if (Platform.OS === 'web' || !isRnZkProverNativeModuleAvailable()) {
    return { ok: false, code: 'umbra_prover_unavailable' };
  }
  if (context.capabilities == null) return { ok: false, code: 'capabilities_loading' };
  if (!isOffpayFeatureAvailable(context.capabilities, 'umbra.execution')) {
    return { ok: false, code: 'feature_unavailable' };
  }
  return { ok: true };
}

function resolveVaultToken(params: {
  network: OffpayNetwork;
  token: string;
}): { ok: true; token: UmbraSupportedToken } | { ok: false; code: string } {
  const token = params.token.trim();
  if (token.length === 0) return { ok: false, code: 'token_missing' };
  try {
    return {
      ok: true,
      token: resolveUmbraSupportedToken({
        network: params.network,
        token,
        tokenMint: isValidSolanaAddress(token) ? token : null,
        requireMixer: true,
      }),
    };
  } catch {
    return { ok: false, code: 'token_not_supported_for_umbra' };
  }
}

function getPublicTokenBalance(params: {
  balance: WalletBalanceResponse | null | undefined;
  mint: string;
}): WalletBalanceResponse['tokens'][number] | null {
  return params.balance?.tokens.find((token) => token.mint === params.mint) ?? null;
}

function getRawPublicTokenBalance(params: {
  balance: WalletBalanceResponse | null | undefined;
  mint: string;
  decimals: number;
}): string | null {
  const token = getPublicTokenBalance(params);
  if (token == null) return null;
  return decimalInputToAtomicAmount(token.balance, params.decimals);
}

function getCachedUmbraBalance(params: {
  context: AgenticToolRunnerContext;
  walletAddress: string;
  network: OffpayNetwork;
  token: UmbraSupportedToken;
}): UmbraEncryptedBalanceSummary | null {
  const matches =
    params.context.queryClient?.getQueriesData<{
      balances?: UmbraEncryptedBalanceSummary[];
    }>({
      queryKey: ['offpay', 'umbraEncryptedBalances', params.network, params.walletAddress] as const,
    }) ?? [];
  for (const [, data] of matches) {
    const balance = data?.balances?.find((item) => item.mint === params.token.mint);
    if (balance != null) return balance;
  }
  return null;
}

async function getUmbraVaultBalance(params: {
  context: AgenticToolRunnerContext;
  walletAddress: string;
  network: OffpayNetwork;
  token: UmbraSupportedToken;
}): Promise<UmbraEncryptedBalanceSummary | null> {
  const cached = getCachedUmbraBalance(params);
  if (cached != null) return cached;

  const result = await fetchUmbraEncryptedBalances({
    walletAddress: params.walletAddress,
    walletId: params.context.walletId,
    network: params.network,
    tokens: [params.token.symbol],
  });
  return result.balances?.find((balance) => balance.mint === params.token.mint) ?? null;
}

export const draftUmbraVaultActionTool: AgenticToolDefinition = {
  name: 'draft_umbra_vault_action',
  schema: {
    name: 'draft_umbra_vault_action',
    description:
      'Prepares an Umbra vault action for explicit confirmation. Use shield/encrypt/deposit to move public token balance into the Umbra vault, and use withdraw/unshield/decrypt to move encrypted Umbra vault balance back to public wallet balance. This is not a payment to another recipient.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['shield', 'unshield', 'withdraw', 'auto'],
          description:
            'shield encrypts public wallet funds into the Umbra vault; unshield/withdraw moves vault funds back to public balance.',
        },
        amount: { type: 'string', description: 'Decimal token amount.' },
        token: {
          type: 'string',
          description: 'Umbra-supported symbol or mint, e.g. USDC, USDT, dUSDC, dUSDT.',
        },
      },
      required: ['operation', 'amount', 'token'],
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };

    const ready = getUmbraVaultActionReadiness(context);
    if (!ready.ok) return { error: { code: ready.code } };

    const operation = readVaultOperation(call, context);
    if (operation == null) return { error: { code: 'operation_missing' } };

    const amountText =
      hydrateStringArg(call, 'amount', context.redactions) || inferAmountFromText(context);
    const tokenText =
      hydrateStringArg(call, 'token', context.redactions) || inferTokenFromText(context);
    const tokenResolution = resolveVaultToken({ network: scope.network, token: tokenText });
    if (!tokenResolution.ok) return { error: { code: tokenResolution.code } };
    const token = tokenResolution.token;

    const amount = sanitizeDecimalInput(amountText, token.decimals);
    const rawAmount = decimalInputToAtomicAmount(amount, token.decimals);
    if (!isPositiveRawAmount(rawAmount)) return { error: { code: 'amount_invalid' } };

    let tokenLogo: string | null = null;
    if (operation === 'shield') {
      if (context.balance == null) return { error: { code: 'balance_loading' } };
      const publicToken = getPublicTokenBalance({ balance: context.balance, mint: token.mint });
      tokenLogo = publicToken?.logo ?? null;
      const balanceRaw = getRawPublicTokenBalance({
        balance: context.balance,
        mint: token.mint,
        decimals: token.decimals,
      });
      if (!rawAmountFitsBalance(rawAmount, balanceRaw)) {
        return { error: { code: 'amount_exceeds_public_balance' } };
      }
    } else {
      const vaultBalance = await getUmbraVaultBalance({
        context,
        walletAddress: scope.walletAddress,
        network: scope.network,
        token,
      });
      if (vaultBalance?.rawBalance == null || vaultBalance.state !== 'shared') {
        return { error: { code: 'umbra_balance_unreadable' } };
      }
      tokenLogo = vaultBalance.logoUri ?? null;
      if (!rawAmountFitsBalance(rawAmount, vaultBalance.rawBalance)) {
        return { error: { code: 'amount_exceeds_umbra_vault_balance' } };
      }
    }

    return {
      result: {
        status: 'drafted',
        route: 'umbra_vault',
        operation,
        amount,
        tokenSymbol: token.symbol,
        network: scope.network,
      },
      draft: {
        kind: 'umbra_vault',
        draft: {
          operation,
          walletAddress: scope.walletAddress,
          network: scope.network,
          amount,
          rawAmount,
          tokenMint: token.mint,
          tokenSymbol: token.symbol,
          tokenName: token.name,
          tokenLogo,
          tokenDecimals: token.decimals,
          signature: null,
          errorMessage: null,
        },
      },
    };
  },
};
