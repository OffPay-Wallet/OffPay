import { applyUmbraTokenLogoAliases } from '@/hooks/useOffpayTokenLogoMap';

const DEVNET_DUSDC_MINT = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';
const DEVNET_DUSDT_MINT = 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6';

describe('applyUmbraTokenLogoAliases', () => {
  it('publishes devnet Umbra token logos from cached stablecoin aliases', () => {
    const byMint = new Map<string, string>();
    const bySymbol = new Map<string, string>([
      ['USDC', 'https://api.example/usdc.png'],
      ['USDT', 'https://api.example/usdt.png'],
    ]);

    applyUmbraTokenLogoAliases('devnet', byMint, bySymbol);

    expect(byMint.get(DEVNET_DUSDC_MINT)).toBe('https://api.example/usdc.png');
    expect(bySymbol.get('DUSDC')).toBe('https://api.example/usdc.png');
    expect(byMint.get(DEVNET_DUSDT_MINT)).toBe('https://api.example/usdt.png');
    expect(bySymbol.get('DUSDT')).toBe('https://api.example/usdt.png');
  });

  it('keeps direct Umbra logos ahead of alias logos', () => {
    const byMint = new Map<string, string>([
      [DEVNET_DUSDC_MINT, 'https://api.example/direct-dusdc.png'],
    ]);
    const bySymbol = new Map<string, string>([
      ['DUSDC', 'https://api.example/direct-dusdc-symbol.png'],
      ['USDC', 'https://api.example/usdc.png'],
    ]);

    applyUmbraTokenLogoAliases('devnet', byMint, bySymbol);

    expect(byMint.get(DEVNET_DUSDC_MINT)).toBe('https://api.example/direct-dusdc.png');
    expect(bySymbol.get('DUSDC')).toBe('https://api.example/direct-dusdc-symbol.png');
  });
});
