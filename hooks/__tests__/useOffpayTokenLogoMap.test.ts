import {
  applyUmbraTokenLogoAliases,
  choosePreferredTokenLogo,
} from '@/hooks/useOffpayTokenLogoMap';

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

  it('uses raster aliases ahead of direct SVG fallback logos', () => {
    const byMint = new Map<string, string>([
      [DEVNET_DUSDC_MINT, 'https://api.example/direct-dusdc.svg'],
    ]);
    const bySymbol = new Map<string, string>([
      ['DUSDC', 'https://api.example/direct-dusdc-symbol.svg'],
      ['USDC', 'https://api.example/usdc.png'],
    ]);

    applyUmbraTokenLogoAliases('devnet', byMint, bySymbol);

    expect(byMint.get(DEVNET_DUSDC_MINT)).toBe('https://api.example/usdc.png');
    expect(bySymbol.get('DUSDC')).toBe('https://api.example/usdc.png');
  });
});

describe('choosePreferredTokenLogo', () => {
  it('prefers PNG/raster logos over SVG fallback logos regardless of source order', () => {
    expect(
      choosePreferredTokenLogo('https://api.example/token.svg', 'https://api.example/token.png'),
    ).toBe('https://api.example/token.png');
    expect(
      choosePreferredTokenLogo('https://api.example/token.png', 'https://api.example/token.svg'),
    ).toBe('https://api.example/token.png');
  });

  it('keeps the later logo when both candidates are the same class', () => {
    expect(
      choosePreferredTokenLogo(
        'https://api.example/token-old.png',
        'https://api.example/token-new.png',
      ),
    ).toBe('https://api.example/token-new.png');
    expect(
      choosePreferredTokenLogo(
        'https://api.example/token-old.svg',
        'https://api.example/token-new.svg',
      ),
    ).toBe('https://api.example/token-new.svg');
  });
});
