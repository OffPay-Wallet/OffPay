import { requestDevnetSolAirdrop as requestDevnetSolAirdropFromApi } from '@/lib/api/offpay-api-client';

export interface DevnetAirdropResult {
  signature: string;
  sol: number;
  tokens: Array<{
    symbol: 'dUSDC' | 'dUSDT' | 'USDC';
    amount: number;
    capAmount: number;
  }>;
  nextEligibleAt: number;
}

function readErrorStringField(error: unknown, field: 'code' | 'message'): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

function readErrorNumberField(error: unknown, field: 'retryAfterMs' | 'status'): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return readErrorStringField(error, 'message') ?? String(error);
}

function isRateLimitError(error: unknown): boolean {
  const status = readErrorNumberField(error, 'status');
  const code = readErrorStringField(error, 'code');
  const message = getErrorMessage(error);

  return (
    status === 429 ||
    code === 'RATE_LIMITED' ||
    /(?:^|\b)(429|too many requests)(?:\b|$)/i.test(message)
  );
}

export async function requestDevnetSolAirdrop(walletAddress: string): Promise<DevnetAirdropResult> {
  const result = await requestDevnetSolAirdropFromApi({
    walletAddress,
    network: 'devnet',
  });

  return {
    signature: result.signature,
    sol: result.sol,
    tokens: result.tokens.map((token) => ({
      symbol: token.symbol,
      amount: token.amount,
      capAmount: token.capAmount,
    })),
    nextEligibleAt: result.nextEligibleAt,
  };
}

export function getDevnetAirdropErrorMessage(error: unknown): string {
  const message = getErrorMessage(error);

  if (isRateLimitError(error)) {
    return 'The Devnet faucet can be used once every 4 hours per wallet.';
  }

  if (/invalid|publickey|address/i.test(message)) {
    return 'The active wallet address is not valid for airdrop.';
  }

  if (/treasury.*not configured|misconfigured/i.test(message)) {
    return 'Devnet faucet treasury is not configured on the backend.';
  }

  if (/treasury.*needs more|insufficient/i.test(message)) {
    return message;
  }

  if (/network|fetch|timeout|failed|rpc/i.test(message)) {
    return 'OffPay Devnet faucet is unreachable right now.';
  }

  return 'Unable to request Devnet SOL right now.';
}

export function getDevnetAirdropRetryAfterMs(error: unknown): number {
  if (!isRateLimitError(error)) return 0;
  return Math.max(0, readErrorNumberField(error, 'retryAfterMs') ?? 0);
}

export const __devnetAirdropInternal = {
  isRateLimitError,
};
