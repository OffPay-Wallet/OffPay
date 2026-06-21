export interface TokenDetailsRouteHoldingSnapshot {
  mint: string;
  priceMint: string;
  priceSymbol: string;
  symbol: string;
  name: string;
  balance: string;
  balanceValue: number;
  logo: string | null;
  usdPrice: number | null;
  verified: boolean;
  spam: boolean;
  priceChange: string | null;
}

function setTextParam(params: Record<string, string>, key: string, value: string | null): void {
  const trimmed = value?.trim();
  if (trimmed) params[key] = trimmed;
}

function setNumberParam(params: Record<string, string>, key: string, value: number | null): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    params[key] = String(value);
  }
}

export function buildTokenDetailsRouteParams(
  holding: TokenDetailsRouteHoldingSnapshot,
): Record<string, string> {
  const params: Record<string, string> = {
    mint: holding.mint,
    symbol: holding.symbol,
    name: holding.name,
    balance: holding.balance,
    balanceValue: String(holding.balanceValue),
    priceMint: holding.priceMint,
    priceSymbol: holding.priceSymbol,
    verified: holding.verified ? '1' : '0',
    spam: holding.spam ? '1' : '0',
  };

  setTextParam(params, 'logo', holding.logo);
  setTextParam(params, 'priceChange', holding.priceChange);
  setNumberParam(params, 'usdPrice', holding.usdPrice);

  return params;
}
