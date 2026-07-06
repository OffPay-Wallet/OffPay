import type { Bindings } from './types.js';
import { isValidSolanaAddress } from './validation.js';

const DEFAULT_DEVNET_PRICE_REFERENCE_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const DEFAULT_TOKEN_DECIMALS = 6;

interface DevnetRwaCatalogToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  priceReferenceMint: string | null;
  underlyingSymbol: string | null;
  settlement: boolean;
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeText(value: unknown, maxLength: number): string | null {
  const raw = readTrimmedString(value);
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function sanitizeSymbol(value: unknown, fallback: string): string {
  return sanitizeText(value, 24) ?? fallback;
}

function readDecimals(value: unknown, fallback = DEFAULT_TOKEN_DECIMALS): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) return fallback;
  return parsed;
}

function readHttpUrl(value: unknown): string | null {
  const raw = readTrimmedString(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

function readSolanaAddress(value: unknown): string | null {
  const raw = readTrimmedString(value);
  return raw && isValidSolanaAddress(raw) ? raw : null;
}

function parseCatalogJson(rawValue: string): unknown[] {
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readDevnetRwaAssetCatalog(bindings: Bindings): DevnetRwaCatalogToken[] {
  const rawCatalog = bindings.OFFPAY_RWA_DEVNET_ASSETS_JSON?.trim() ?? '';
  if (rawCatalog.length > 0) {
    return parseCatalogJson(rawCatalog).flatMap((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      const mint = readSolanaAddress(record.mint ?? record.assetMint);
      if (!mint) return [];

      const symbol = sanitizeSymbol(record.symbol, `RWA${index + 1}`);
      const priceReferenceMint = readSolanaAddress(
        record.priceReferenceMint ?? record.referenceMint ?? record.mainnetMint,
      );

      return [
        {
          mint,
          symbol,
          name: symbol,
          decimals: readDecimals(record.decimals),
          logo: readHttpUrl(record.logo ?? record.icon ?? record.logoURI),
          priceReferenceMint,
          underlyingSymbol: sanitizeText(record.underlyingSymbol, 24),
          settlement: false,
        },
      ];
    });
  }

  const fallbackMint = readSolanaAddress(bindings.OFFPAY_RWA_DEVNET_SANDBOX_MINT);
  if (!fallbackMint) return [];
  const symbol = sanitizeSymbol(bindings.OFFPAY_RWA_DEVNET_SANDBOX_SYMBOL, 'AAPLd');

  return [
    {
      mint: fallbackMint,
      symbol,
      name: symbol,
      decimals: readDecimals(bindings.OFFPAY_RWA_DEVNET_SANDBOX_DECIMALS),
      logo: null,
      priceReferenceMint:
        readSolanaAddress(bindings.OFFPAY_RWA_DEVNET_PRICE_REFERENCE_MINT) ??
        DEFAULT_DEVNET_PRICE_REFERENCE_MINT,
      underlyingSymbol: null,
      settlement: false,
    },
  ];
}

function readDevnetRwaSettlementToken(bindings: Bindings): DevnetRwaCatalogToken | null {
  const mint = readSolanaAddress(bindings.OFFPAY_RWA_DEVNET_SETTLEMENT_MINT);
  if (!mint) return null;

  return {
    mint,
    symbol: 'RWAUSDC',
    name: 'RWAUSDC',
    decimals: DEFAULT_TOKEN_DECIMALS,
    logo: null,
    priceReferenceMint: null,
    underlyingSymbol: 'USDC',
    settlement: true,
  };
}

function readDevnetRwaCatalogTokens(bindings: Bindings): DevnetRwaCatalogToken[] {
  const tokens: DevnetRwaCatalogToken[] = [];
  const settlementToken = readDevnetRwaSettlementToken(bindings);
  if (settlementToken != null) tokens.push(settlementToken);
  tokens.push(...readDevnetRwaAssetCatalog(bindings));
  return tokens;
}

function readDevnetRwaCatalogTokenMap(bindings: Bindings): Map<string, DevnetRwaCatalogToken> {
  const tokensByMint = new Map<string, DevnetRwaCatalogToken>();
  for (const token of readDevnetRwaCatalogTokens(bindings)) {
    tokensByMint.set(token.mint, token);
  }
  return tokensByMint;
}

export {
  readDevnetRwaCatalogTokenMap,
  readDevnetRwaCatalogTokens,
  type DevnetRwaCatalogToken,
};
