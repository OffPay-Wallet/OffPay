import { fetchAlchemyTokenUsdPrice } from './alchemy-prices.js';
import { getSwapTokens } from './jupiter.js';
import type { Bindings, Network } from './types.js';

const HOT_PRICE_CACHE_KEY = 'token-prices:global';
const HOT_PRICE_CACHE_TTL_SECONDS = 10 * 60;
const TOKEN_REGISTRY_CACHE_TTL_SECONDS = 24 * 60 * 60;
const HOT_CACHE_NETWORKS: readonly Network[] = ['mainnet', 'devnet'];

type HotTokenPrices = {
  prices: Record<string, number>;
  updatedAt: number;
};

export async function refreshHotCaches(bindings: Bindings): Promise<void> {
  await Promise.allSettled([refreshStableTokenPrices(bindings), refreshTokenRegistries(bindings)]);
}

export async function refreshStableTokenPrices(bindings: Bindings): Promise<void> {
  if (bindings.PRICE_CACHE == null) return;

  const solPrice = await fetchAlchemyTokenUsdPrice(bindings, {
    type: 'symbol',
    symbol: 'SOL',
  }).catch(() => null);
  const prices: Record<string, number> = {
    USDC: 1,
    USDT: 1,
    DUSDC: 1,
    DUSDT: 1,
  };
  if (
    typeof solPrice?.value === 'number' &&
    Number.isFinite(solPrice.value) &&
    solPrice.value > 0
  ) {
    prices.SOL = solPrice.value;
    prices.WSOL = solPrice.value;
  }

  const payload: HotTokenPrices = {
    prices,
    updatedAt: Date.now(),
  };

  await bindings.PRICE_CACHE.put(HOT_PRICE_CACHE_KEY, JSON.stringify(payload), {
    expirationTtl: HOT_PRICE_CACHE_TTL_SECONDS,
  });
}

export async function refreshTokenRegistries(bindings: Bindings): Promise<void> {
  if (bindings.TOKEN_REGISTRY_CACHE == null) return;

  await Promise.allSettled(
    HOT_CACHE_NETWORKS.map(async (network) => {
      const registry = await getSwapTokens(bindings, network);
      await bindings.TOKEN_REGISTRY_CACHE?.put(
        `swap-tokens:${network}:verified`,
        JSON.stringify(registry),
        {
          expirationTtl: TOKEN_REGISTRY_CACHE_TTL_SECONDS,
        },
      );
    }),
  );
}

export { HOT_PRICE_CACHE_KEY };
export type { HotTokenPrices };
