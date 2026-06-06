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

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate|limit|too many/i.test(message);
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
  const message = error instanceof Error ? error.message : String(error);

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

export const __devnetAirdropInternal = {
  isRateLimitError,
};
