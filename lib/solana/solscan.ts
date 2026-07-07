import type { OffpayNetwork } from '@/types/offpay-api';

export function buildSolscanTxUrl(signature: string, network: OffpayNetwork): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}
