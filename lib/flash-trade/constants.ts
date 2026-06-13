export const FLASH_API_BASE_URL = 'https://flashapi.trade';

export const FLASH_API_TIMEOUT_MS = 30_000;

export const FLASH_MIN_COLLATERAL_USD = 10;

export const FLASH_MIN_COLLATERAL_WITH_TPSL_USD = 12;

export const FLASH_MAX_TRIGGER_ORDERS_PER_POSITION = 5;

export const FLASH_PRICE_STALE_THRESHOLD_MS = 30_000;

export const FLASH_DEFAULT_SLIPPAGE_BPS = 50;

export const FLASH_BLOCKHASH_EXPIRY_MS = 60_000;

export const FLASH_MAX_LEVERAGE_STANDARD = 20;

export const FLASH_MAX_LEVERAGE_DEGEN = 50;

export const FLASH_SUPPORTED_INPUT_TOKENS = ['USDC', 'SOL', 'JitoSOL'] as const;

export const FLASH_SUPPORTED_MARKETS = ['SOL', 'BTC', 'ETH'] as const;

export const FLASH_ANALYTICS_TIMEOUT_MS = 60_000;

export const FLASH_ANALYTICS_MAX_POSITIONS = 500;

export const FLASH_ANALYTICS_CACHE_TTL_MS = 15_000;

export type FlashSupportedInputToken = (typeof FLASH_SUPPORTED_INPUT_TOKENS)[number];

export type FlashSupportedMarket = (typeof FLASH_SUPPORTED_MARKETS)[number];
