const DEVNET_AIRDROP_SOL = 1;

export interface DevnetAirdropResult {
  signature: string;
  sol: number;
}

export async function requestDevnetSolAirdrop(walletAddress: string): Promise<DevnetAirdropResult> {
  const { Connection, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } =
    await import('@solana/web3.js');

  const recipient = new PublicKey(walletAddress);
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const signature = await connection.requestAirdrop(
    recipient,
    DEVNET_AIRDROP_SOL * LAMPORTS_PER_SOL,
  );
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
}

export function getDevnetAirdropErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/429|rate|limit|too many/i.test(message)) {
    return 'The devnet faucet is rate limited. Try again later.';
  }

  if (/invalid|publickey|address/i.test(message)) {
    return 'The active wallet address is not valid for airdrop.';
  }

  if (/network|fetch|timeout|failed|rpc/i.test(message)) {
    return 'Devnet faucet is unreachable right now.';
  }

  return 'Unable to request Devnet SOL right now.';
}
