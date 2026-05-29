import type { UmbraEncryptedBalanceSummary } from '@/lib/umbra/umbra-execution';
import type { UmbraSupportedToken, UmbraTokenSymbol } from '@/lib/umbra/umbra-supported-tokens';

export type UmbraVaultAction = 'shield' | 'withdraw';

export type UmbraVaultToken = UmbraTokenSymbol;

export type UmbraVaultBalance = UmbraEncryptedBalanceSummary;

export type UmbraVaultTokenConfig = UmbraSupportedToken;
