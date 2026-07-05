import { AppError } from './errors.js';
import { isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

type RwaAssetCategory = 'equity' | 'etf' | 'treasury' | 'commodity';
type RwaProvider = 'offpay-devnet';
type RwaExecutionMode = 'devnet_sandbox' | 'dex' | 'issuer' | 'disabled';
type RwaRiskLevel = 'sandbox' | 'low' | 'medium' | 'high';

interface RwaExecutionPolicy {
  buy: RwaExecutionMode;
  sell: RwaExecutionMode;
  transfer: RwaExecutionMode;
  magicBlock: RwaExecutionMode;
}

interface RwaAsset {
  id: string;
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  network: Network;
  category: RwaAssetCategory;
  provider: RwaProvider;
  providerLabel: string;
  settlementMint: string;
  settlementSymbol: 'USDC';
  priceUsd: number;
  change24hPct: number;
  verified: boolean;
  tradable: boolean;
  devnetSandbox: boolean;
  magicBlockEligible: boolean;
  riskLevel: RwaRiskLevel;
  complianceLabel: string;
  execution: RwaExecutionPolicy;
}

interface RwaAssetsResponse {
  network: Network;
  mode: 'devnet_sandbox' | 'mainnet_disabled';
  assets: RwaAsset[];
  fetchedAt: number;
}

interface RwaPriceResponse {
  network: Network;
  mint: string;
  symbol: string;
  price: number;
  currency: 'USD';
  change24hPct: number;
  provider: RwaProvider;
  fetchedAt: number;
}

const DEVNET_USDC_MINT_FALLBACK = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const DEVNET_RWA_ASSET_FIXTURES = [
  {
    id: 'devnet-aaplx',
    symbol: 'dAAPLx',
    name: 'Devnet Apple xStock',
    mint: 'FduetofJwjANYfpR6VL7d18RTov3AWp1xS1Kq3Z4fVYi',
    category: 'equity' as const,
    priceUsd: 213.42,
    change24hPct: 0.84,
  },
  {
    id: 'devnet-spyx',
    symbol: 'dSPYx',
    name: 'Devnet S&P 500 ETF xStock',
    mint: 'Ac4uYWfdPpANhGD5s1p9gMjt8QvNv6E5uqj4gX33sadT',
    category: 'etf' as const,
    priceUsd: 628.75,
    change24hPct: 0.31,
  },
  {
    id: 'devnet-ustry',
    symbol: 'dUSTRY',
    name: 'Devnet US Treasury Token',
    mint: '71UYG4gX8D8QFARx4qzXMbvSyMNdV2TchkW8zw9HyVU',
    category: 'treasury' as const,
    priceUsd: 1.02,
    change24hPct: 0.02,
  },
] satisfies Array<
  Pick<
    RwaAsset,
    'id' | 'symbol' | 'name' | 'mint' | 'category' | 'priceUsd' | 'change24hPct'
  >
>;

function readDevnetSettlementMint(bindings: Bindings): string {
  const configured = bindings.OFFPAY_RWA_DEVNET_SETTLEMENT_MINT?.trim();
  if (configured && isValidSolanaAddress(configured)) {
    return configured;
  }

  const devnetUsdc = bindings.OFFPAY_DEVNET_USDC_MINT?.trim();
  if (devnetUsdc && isValidSolanaAddress(devnetUsdc)) {
    return devnetUsdc;
  }

  return DEVNET_USDC_MINT_FALLBACK;
}

function buildDevnetAsset(
  bindings: Bindings,
  fixture: (typeof DEVNET_RWA_ASSET_FIXTURES)[number],
): RwaAsset {
  return {
    ...fixture,
    decimals: 6,
    network: 'devnet',
    provider: 'offpay-devnet',
    providerLabel: 'OffPay devnet sandbox',
    settlementMint: readDevnetSettlementMint(bindings),
    settlementSymbol: 'USDC',
    verified: true,
    tradable: false,
    devnetSandbox: true,
    magicBlockEligible: false,
    riskLevel: 'sandbox',
    complianceLabel: 'Sandbox asset. Not backed by real-world securities.',
    execution: {
      buy: 'disabled',
      sell: 'disabled',
      transfer: 'disabled',
      magicBlock: 'disabled',
    },
  };
}

function getRwaAssets(bindings: Bindings, network: Network): RwaAssetsResponse {
  const fetchedAt = Date.now();
  if (network !== 'devnet') {
    return {
      network,
      mode: 'mainnet_disabled',
      assets: [],
      fetchedAt,
    };
  }

  return {
    network,
    mode: 'devnet_sandbox',
    assets: DEVNET_RWA_ASSET_FIXTURES.map((fixture) => buildDevnetAsset(bindings, fixture)),
    fetchedAt,
  };
}

function getRwaPrice(
  bindings: Bindings,
  request: { mint: string; network: Network },
): RwaPriceResponse {
  const asset = getRwaAssets(bindings, request.network).assets.find(
    (entry) => entry.mint === request.mint,
  );

  if (!asset) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'RWA asset is not available on this network.',
    });
  }

  return {
    network: request.network,
    mint: asset.mint,
    symbol: asset.symbol,
    price: asset.priceUsd,
    currency: 'USD',
    change24hPct: asset.change24hPct,
    provider: asset.provider,
    fetchedAt: Date.now(),
  };
}

export {
  getRwaAssets,
  getRwaPrice,
  type RwaAsset,
  type RwaAssetCategory,
  type RwaAssetsResponse,
  type RwaExecutionMode,
  type RwaExecutionPolicy,
  type RwaPriceResponse,
  type RwaProvider,
  type RwaRiskLevel,
};
