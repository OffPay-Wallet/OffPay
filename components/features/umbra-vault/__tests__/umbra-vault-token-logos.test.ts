import { resolveUmbraTokenLogo } from '@/components/features/umbra-vault/umbra-vault-token-logos';

import type { UmbraVaultTokenConfig } from '@/components/features/umbra-vault/types';

const DUSDT_TOKEN: UmbraVaultTokenConfig = {
  symbol: 'dUSDT',
  name: 'Devnet USDT (Umbra test)',
  mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
  decimals: 6,
  encryptedBalance: true,
  mixer: true,
  aliases: ['USDT'],
  logoUri: 'https://static.example/tether.svg',
};

describe('umbra-vault-token-logos', () => {
  it('uses API-backed alias logo data for Umbra devnet tokens', () => {
    const lookup = {
      byMint: new Map<string, string>(),
      bySymbol: new Map<string, string>([['USDT', 'https://api.example/usdt.png']]),
    };

    expect(resolveUmbraTokenLogo(DUSDT_TOKEN, lookup)).toBe('https://api.example/usdt.png');
  });

  it('does not fall back to static Umbra SVG logo config', () => {
    const lookup = {
      byMint: new Map<string, string>(),
      bySymbol: new Map<string, string>(),
    };

    expect(resolveUmbraTokenLogo(DUSDT_TOKEN, lookup)).toBeNull();
  });
});
