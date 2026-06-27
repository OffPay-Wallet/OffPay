import type { UmbraVaultTokenConfig } from './types';

export interface UmbraVaultTokenLogoLookup {
  byMint: ReadonlyMap<string, string>;
  bySymbol: ReadonlyMap<string, string>;
}

function readLookupLogo(value: string | undefined): string | null {
  const logo = value?.trim();
  return logo != null && logo.length > 0 ? logo : null;
}

export function resolveUmbraTokenLogo(
  token: UmbraVaultTokenConfig,
  lookup: UmbraVaultTokenLogoLookup | undefined,
): string | null {
  const fromMint = readLookupLogo(lookup?.byMint.get(token.mint));
  if (fromMint != null) return fromMint;

  const fromSymbol = readLookupLogo(lookup?.bySymbol.get(token.symbol.toUpperCase()));
  if (fromSymbol != null) return fromSymbol;

  for (const alias of token.aliases ?? []) {
    const fromAlias = readLookupLogo(lookup?.bySymbol.get(alias.toUpperCase()));
    if (fromAlias != null) return fromAlias;
  }

  // Keep vault token icons API/cache-backed only. The static Umbra token
  // config contains remote SVG URLs that can visibly land after the pane
  // transition, especially for dUSDT.
  return null;
}
