import type { useOffpayNetwork } from '@/hooks/useOffpayNetwork';

export interface SendTokenOption {
  mint: string;
  name: string;
  symbol: string;
  logo: string | null;
  balance: string;
  decimals: number;
  verified: boolean;
  privateSupported: boolean;
}

export interface RecentRecipientOption {
  address: string;
  name?: string;
  usedAt: number;
  useCount: number;
  isContact: boolean;
}

export type SendNetwork = NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;

export type PrivatePaymentRoute = 'normal' | 'magicblock' | 'umbra';

export interface PrivatePaymentRouteOption {
  id: PrivatePaymentRoute;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}
