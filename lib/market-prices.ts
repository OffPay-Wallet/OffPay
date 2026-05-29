import { DEFAULT_NETWORK, toOffpayNetwork } from '@/constants/networks';
import { getSwapPrice } from '@/lib/api/offpay-api-client';

import type { OffpayNetwork } from '@/types/offpay-api';

const MARKET_PRICE_NETWORK = toOffpayNetwork(DEFAULT_NETWORK);

function isPositiveUsdPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function readSwapUsdPrice(mint: string, network: OffpayNetwork): Promise<number | null> {
  try {
    const result = await getSwapPrice(mint, network);
    return isPositiveUsdPrice(result.price) ? result.price : null;
  } catch {
    return null;
  }
}

export async function getTokenUsdPriceForValuation(params: {
  mint: string;
  network: OffpayNetwork;
}): Promise<number | null> {
  const mint = params.mint.trim();
  if (mint.length === 0) return null;

  const activeNetworkPrice = await readSwapUsdPrice(mint, params.network);
  if (activeNetworkPrice != null) return activeNetworkPrice;

  if (params.network === MARKET_PRICE_NETWORK) return null;
  return readSwapUsdPrice(mint, MARKET_PRICE_NETWORK);
}
