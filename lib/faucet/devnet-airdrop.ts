const DEVNET_AIRDROP_SOL = 1;
const PUBLIC_DEVNET_RPC_URL = 'https://api.devnet.solana.com';

export interface DevnetAirdropResult {
  signature: string;
  sol: number;
}

function readConfiguredUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null;
  } catch {
    return null;
  }
}

function uniqueUrls(urls: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const url of urls) {
    if (url == null || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }

  return result;
}

function getDevnetRpcCandidates(publicDevnetRpcUrl = PUBLIC_DEVNET_RPC_URL): string[] {
  return uniqueUrls([
    readConfiguredUrl(process.env.EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL),
    readConfiguredUrl(process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL),
    readConfiguredUrl(process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL),
    readConfiguredUrl(process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_FALLBACK_RPC_URL),
    publicDevnetRpcUrl,
  ]);
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate|limit|too many/i.test(message);
}

function isEndpointRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return isRateLimitError(error) || /network|fetch|timeout|failed|rpc|502|503|504/i.test(message);
}

export async function requestDevnetSolAirdrop(walletAddress: string): Promise<DevnetAirdropResult> {
  const { Connection, LAMPORTS_PER_SOL, PublicKey } =
    require('@solana/web3.js') as typeof import('@solana/web3.js');

  const recipient = new PublicKey(walletAddress);
  const lamports = DEVNET_AIRDROP_SOL * LAMPORTS_PER_SOL;
  let lastError: unknown = null;

  for (const rpcUrl of getDevnetRpcCandidates()) {
    try {
      const connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        disableRetryOnRateLimit: true,
      });
      const signature = await connection.requestAirdrop(recipient, lamports);
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');

      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      );

      return { signature, sol: DEVNET_AIRDROP_SOL };
    } catch (error) {
      lastError = error;

      if (!isEndpointRetryableError(error)) {
        break;
      }
    }
  }

  throw lastError ?? new Error('Devnet faucet is unavailable.');
}

export function getDevnetAirdropErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (isRateLimitError(error)) {
    return 'The devnet faucet is rate limited. Configure a private Devnet RPC or try again later.';
  }

  if (/invalid|publickey|address/i.test(message)) {
    return 'The active wallet address is not valid for airdrop.';
  }

  if (/network|fetch|timeout|failed|rpc/i.test(message)) {
    return 'Devnet faucet is unreachable right now.';
  }

  return 'Unable to request Devnet SOL right now.';
}

export const __devnetAirdropInternal = {
  getDevnetRpcCandidates,
  isEndpointRetryableError,
  isRateLimitError,
};
