export const FLASH_API_BASE_URL = 'https://flashapi.trade';

/** Trading transactions from the V2 builders must be submitted here, not to L1. */
export const FLASH_MAGICBLOCK_RPC_URL = 'https://flash.magicblock.xyz';

export const FLASH_V2_PROGRAM_ID = 'FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn';

export const FLASH_API_TIMEOUT_MS = 30_000;
export const FLASH_CONFIRMATION_TIMEOUT_MS = 60_000;

/** Flash rejects trigger/limit positions at or below $10 after fees. */
export const FLASH_MIN_COLLATERAL_USD = 10;
export const FLASH_MIN_COLLATERAL_WITH_TPSL_USD = 11;
export const FLASH_MAX_TRIGGER_ORDERS_PER_POSITION = 5;
export const FLASH_PRICE_STALE_THRESHOLD_MS = 30_000;
export const FLASH_DEFAULT_SLIPPAGE_BPS = 50;
export const FLASH_MAX_SLIPPAGE_BPS = 500;

export const FLASH_ANALYTICS_TIMEOUT_MS = 60_000;
export const FLASH_ANALYTICS_MAX_POSITIONS = 500;
export const FLASH_ANALYTICS_CACHE_TTL_MS = 15_000;
