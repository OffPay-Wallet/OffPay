import type { DevnetAirdropResult } from '@/lib/faucet/devnet-airdrop';
import type {
  OffpayNetwork,
  RwaAsset,
  RwaQuoteResponse,
  WalletBalanceResponse,
} from '@/types/offpay-api';

const DEVNET_SANDBOX_SETTLEMENT_SYMBOL = 'RWAUSDC';
const DEFAULT_DEVNET_SANDBOX_DECIMALS = 6;
const MAX_SUPPORTED_DECIMALS = 18;

type RwaTradeSide = 'buy' | 'sell';
type DecimalRounding = 'floor' | 'ceil';

export interface RwaDevnetSandboxFundingInput {
  asset: Pick<
    RwaAsset,
    'decimals' | 'devnetSandbox' | 'mint' | 'settlementMint' | 'settlementSymbol' | 'symbol'
  >;
  side: RwaTradeSide;
  inputAmount: string;
  network: OffpayNetwork;
  quote: Pick<
    RwaQuoteResponse,
    'assetMint' | 'cashAmount' | 'providerEnvironment' | 'quantity' | 'settlementMint'
  >;
  walletBalance: WalletBalanceResponse | null | undefined;
}

export interface RwaDevnetSandboxFundingRequirement {
  mint: string;
  symbol: string;
  amount: string;
  balanceAmount: string;
  missingAmount: string;
  rawAmount: bigint;
  rawBalance: bigint;
  decimals: number;
  hasEnough: boolean;
}

function isSupportedDecimals(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SUPPORTED_DECIMALS;
}

function parseDecimalAmountToAtoms(
  value: string,
  decimals: number,
  rounding: DecimalRounding,
): bigint | null {
  if (!isSupportedDecimals(decimals)) return null;

  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;

  const [wholeText, fractionText = ''] = trimmed.split('.');
  const whole = BigInt(wholeText.replace(/^0+(?=\d)/, '') || '0');
  const multiplier = 10n ** BigInt(decimals);
  const retainedFraction = fractionText.slice(0, decimals).padEnd(decimals, '0');
  const fraction = retainedFraction.length > 0 ? BigInt(retainedFraction) : 0n;
  const discardedFraction = fractionText.slice(decimals);
  const shouldRoundUp = rounding === 'ceil' && /[1-9]/.test(discardedFraction);

  return whole * multiplier + fraction + (shouldRoundUp ? 1n : 0n);
}

function formatAtomsAsDecimal(rawAmount: bigint, decimals: number): string {
  if (!isSupportedDecimals(decimals) || decimals === 0) return rawAmount.toString();

  const multiplier = 10n ** BigInt(decimals);
  const whole = rawAmount / multiplier;
  const fraction = rawAmount % multiplier;
  if (fraction === 0n) return whole.toString();

  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionText}`;
}

function getWalletTokenBalance(params: {
  fallbackDecimals: number;
  mint: string;
  walletBalance: WalletBalanceResponse | null | undefined;
}): { decimals: number; rawBalance: bigint } {
  const token = params.walletBalance?.tokens.find(
    (entry) => entry.mint === params.mint && !entry.spam,
  );
  const decimals = isSupportedDecimals(token?.decimals ?? NaN)
    ? token!.decimals
    : params.fallbackDecimals;
  const rawBalance =
    token == null ? 0n : (parseDecimalAmountToAtoms(token.balance, decimals, 'floor') ?? 0n);

  return {
    decimals,
    rawBalance,
  };
}

function getDevnetSandboxFundingFields(input: RwaDevnetSandboxFundingInput): {
  amount: string;
  fallbackDecimals: number;
  mint: string;
  symbol: string;
} | null {
  if (input.network !== 'devnet' || !input.asset.devnetSandbox) return null;
  if (input.quote.providerEnvironment !== 'devnet_sandbox') return null;

  if (input.side === 'buy') {
    const mint = input.quote.settlementMint ?? input.asset.settlementMint;
    if (mint.trim().length === 0) {
      throw new Error('RWA quote is missing the Devnet settlement mint. Request a fresh quote.');
    }

    return {
      amount: input.quote.cashAmount ?? input.inputAmount,
      fallbackDecimals: DEFAULT_DEVNET_SANDBOX_DECIMALS,
      mint,
      symbol: DEVNET_SANDBOX_SETTLEMENT_SYMBOL,
    };
  }

  const mint = input.quote.assetMint ?? input.asset.mint;
  if (mint.trim().length === 0) {
    throw new Error('RWA quote is missing the Devnet asset mint. Request a fresh quote.');
  }

  return {
    amount: input.quote.quantity ?? input.inputAmount,
    fallbackDecimals: input.asset.decimals ?? DEFAULT_DEVNET_SANDBOX_DECIMALS,
    mint,
    symbol: input.asset.symbol,
  };
}

export function getRwaDevnetSandboxFundingRequirement(
  input: RwaDevnetSandboxFundingInput,
): RwaDevnetSandboxFundingRequirement | null {
  const fields = getDevnetSandboxFundingFields(input);
  if (fields == null) return null;

  const { decimals, rawBalance } = getWalletTokenBalance({
    fallbackDecimals: fields.fallbackDecimals,
    mint: fields.mint,
    walletBalance: input.walletBalance,
  });
  const rawAmount = parseDecimalAmountToAtoms(fields.amount, decimals, 'ceil');
  if (rawAmount == null || rawAmount <= 0n) {
    throw new Error('RWA quote amount is invalid. Request a fresh quote.');
  }

  const missingRawAmount = rawAmount > rawBalance ? rawAmount - rawBalance : 0n;
  return {
    mint: fields.mint,
    symbol: fields.symbol,
    amount: formatAtomsAsDecimal(rawAmount, decimals),
    balanceAmount: formatAtomsAsDecimal(rawBalance, decimals),
    missingAmount: formatAtomsAsDecimal(missingRawAmount, decimals),
    rawAmount,
    rawBalance,
    decimals,
    hasEnough: rawBalance >= rawAmount,
  };
}

export function formatRwaDevnetSandboxFundingMessage(
  requirement: RwaDevnetSandboxFundingRequirement,
): string {
  return `Devnet sandbox needs ${requirement.amount} ${requirement.symbol}; wallet has ${requirement.balanceAmount}. Funding with the OffPay Devnet faucet before signing.`;
}

export function assertRwaDevnetSandboxFaucetCoversRequirement(
  requirement: RwaDevnetSandboxFundingRequirement,
  result: DevnetAirdropResult,
): void {
  const token = result.tokens.find(
    (entry) => entry.mint === requirement.mint || entry.symbol === requirement.symbol,
  );
  if (token == null) {
    throw new Error(
      `Devnet faucet did not return ${requirement.symbol}. Backend RWA sandbox faucet tokens are not configured.`,
    );
  }

  const capRawAmount = /^\d+$/.test(token.capRawAmount) ? BigInt(token.capRawAmount) : null;
  if (capRawAmount == null || capRawAmount < requirement.rawAmount) {
    throw new Error(
      `Devnet faucet caps ${requirement.symbol} at ${token.capAmount}. Reduce the order size or fund this wallet manually on Devnet.`,
    );
  }
}

export const __rwaDevnetSandboxFundingInternal = {
  formatAtomsAsDecimal,
  parseDecimalAmountToAtoms,
};
