export interface FiatCurrencyParts {
  symbol: string;
  amount: string;
}

export type FiatMoneyTextSize = 'hero' | 'list' | 'caption';

export function resolveFiatMoneyMetrics(
  size: FiatMoneyTextSize,
  compact: boolean,
  amountFontSize?: number,
): {
  fontSize: number;
  lineHeight: number;
} {
  if (amountFontSize != null) {
    const lineHeight = Math.round(amountFontSize * 1.14);
    return { fontSize: amountFontSize, lineHeight };
  }

  if (size === 'hero') {
    return compact
      ? { fontSize: 34, lineHeight: 40 }
      : { fontSize: 42, lineHeight: 48 };
  }

  if (size === 'caption') {
    return compact
      ? { fontSize: 8, lineHeight: 11 }
      : { fontSize: 9, lineHeight: 12 };
  }

  return compact
    ? { fontSize: 12, lineHeight: 16 }
    : { fontSize: 13, lineHeight: 17 };
}
