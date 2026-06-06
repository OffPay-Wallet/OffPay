import {
  isOffpayOfflineP2pReceipt,
  shortenWalletAddress,
  type OffpayLocalReceiptViewInput,
} from '@/lib/api/offpay-wallet-data';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';

import type { AdvancedSwapReceipt, SwapReceiptTokenLeg } from '@/store/advancedSwapStore';
import type { OfflinePaymentReceipt } from '@/store/offlinePaymentStore';
import type { PrivatePaymentReceipt } from '@/store/privatePaymentStore';
import type { OffpayNetwork } from '@/types/offpay-api';

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const HELIUS_NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
const NATIVE_SOL_SENTINEL_MINT = 'native-sol';

interface BuildLocalHistoryReceiptInputsParams {
  network: OffpayNetwork | null;
  walletAddress?: string | null;
  offlineReceipts?: readonly OfflinePaymentReceipt[];
  privatePaymentReceipts?: readonly PrivatePaymentReceipt[];
  swapReceipts?: readonly AdvancedSwapReceipt[];
}

function isNativeSolMint(mint: string | null | undefined): boolean {
  const normalized = mint?.trim();
  return (
    normalized === NATIVE_SOL_MINT ||
    normalized === HELIUS_NATIVE_SOL_MINT ||
    normalized === NATIVE_SOL_SENTINEL_MINT
  );
}

function normalizeSymbol(symbol: string | null | undefined, mint?: string | null): string | null {
  const trimmed = symbol?.trim();
  if (trimmed) return trimmed.toUpperCase();
  if (isNativeSolMint(mint)) return 'SOL';
  return null;
}

function normalizeDecimals(decimals: number | null | undefined, mint?: string | null): number {
  if (typeof decimals === 'number' && Number.isFinite(decimals) && decimals >= 0) {
    return Math.trunc(decimals);
  }
  return isNativeSolMint(mint) ? 9 : 6;
}

function amountLabel(params: {
  sign: '+' | '-';
  rawAmount: string | null | undefined;
  decimals: number;
  symbol: string | null;
}): string | null {
  const rawAmount = params.rawAmount?.trim();
  if (rawAmount == null || rawAmount.length === 0 || params.symbol == null) return null;
  return `${params.sign}${formatAtomicAmount(rawAmount, params.decimals, 6)} ${params.symbol}`;
}

function receiptMatchesNetwork(
  receipt: { network: OffpayNetwork },
  network: OffpayNetwork | null,
): boolean {
  return network == null || receipt.network === network;
}

function privateReceiptMatchesWallet(
  receipt: PrivatePaymentReceipt,
  walletAddress: string | null | undefined,
): boolean {
  const wallet = walletAddress?.trim();
  if (!wallet) return true;
  return receipt.walletAddress === wallet || receipt.recipient === wallet;
}

function swapReceiptMatchesWallet(
  receipt: AdvancedSwapReceipt,
  walletAddress: string | null | undefined,
): boolean {
  const wallet = walletAddress?.trim();
  if (!wallet || receipt.walletAddress == null) return true;
  return receipt.walletAddress === wallet;
}

function getPrivateReceiptRouteId(receipt: PrivatePaymentReceipt): string {
  if (receipt.source === 'agentic') return 'agentic-private-send';
  if (receipt.route === 'normal') return 'online-send';
  return 'private-send';
}

function getPrivateReceiptRouteLabel(receipt: PrivatePaymentReceipt): string {
  if (receipt.source === 'agentic') return 'Yuga Transfer';
  if (receipt.route === 'normal') return 'Normal';
  if (receipt.route === 'umbra') return 'Umbra';
  return 'MagicBlock';
}

function getPrivateReceiptProgramLabel(receipt: PrivatePaymentReceipt): string {
  if (receipt.route === 'normal') return 'Normal transfer';
  if (receipt.route === 'umbra') return 'Umbra';
  return 'MagicBlock';
}

export function mapPrivatePaymentReceiptToLocalHistoryInput(
  receipt: PrivatePaymentReceipt,
): OffpayLocalReceiptViewInput {
  const symbol = normalizeSymbol(receipt.tokenSymbol, receipt.mint);
  const decimals = normalizeDecimals(receipt.tokenDecimals, receipt.mint);
  const reference = receipt.signature ?? receipt.txId ?? receipt.initSignature ?? receipt.id;
  const routeId = getPrivateReceiptRouteId(receipt);

  return {
    id: `${routeId}-${receipt.network}-${reference}`,
    type: 'send',
    direction: 'send',
    status: receipt.status === 'queued' ? 'queued' : 'settled',
    title: receipt.source === 'agentic' ? 'Yuga transfer' : 'Payment sent',
    subtitle: `To ${shortenWalletAddress(receipt.recipient)}`,
    amountLabel: amountLabel({
      sign: '-',
      rawAmount: receipt.amount,
      decimals,
      symbol,
    }),
    rawAmount: receipt.amount,
    tokenMint: receipt.mint,
    tokenSymbol: symbol,
    tokenName: receipt.tokenName ?? symbol,
    tokenLogo: receipt.tokenLogo ?? null,
    tokenDecimals: decimals,
    createdAt: receipt.createdAt,
    signature: receipt.signature,
    sender: receipt.walletAddress,
    recipient: receipt.recipient,
    network: receipt.network,
    routeLabel: getPrivateReceiptRouteLabel(receipt),
    privacyLabel: receipt.route === 'normal' ? 'Public route' : 'Private route',
    programLabel: getPrivateReceiptProgramLabel(receipt),
  };
}

function normalizeSwapLeg(leg: SwapReceiptTokenLeg | null | undefined): Required<SwapReceiptTokenLeg> {
  const mint = leg?.mint?.trim() || null;
  const symbol = normalizeSymbol(leg?.symbol, mint);
  const decimals =
    typeof leg?.decimals === 'number' && Number.isFinite(leg.decimals)
      ? Math.trunc(leg.decimals)
      : null;

  return {
    mint,
    symbol,
    name: leg?.name?.trim() || symbol,
    logo: leg?.logo?.trim() || null,
    decimals,
    rawAmount: leg?.rawAmount?.trim() || null,
    amountLabel: leg?.amountLabel?.trim() || null,
  };
}

export function mapSwapReceiptToLocalHistoryInput(
  receipt: AdvancedSwapReceipt,
): OffpayLocalReceiptViewInput {
  const input = normalizeSwapLeg(receipt.input);
  const output = normalizeSwapLeg(receipt.output);
  const primary = output.symbol != null || output.mint != null ? output : input;
  const inputLabel =
    input.amountLabel ??
    amountLabel({
      sign: '-',
      rawAmount: input.rawAmount,
      decimals: normalizeDecimals(input.decimals, input.mint),
      symbol: input.symbol,
    });
  const outputLabel =
    output.amountLabel ??
    amountLabel({
      sign: '+',
      rawAmount: output.rawAmount,
      decimals: normalizeDecimals(output.decimals, output.mint),
      symbol: output.symbol,
    });
  const reference = receipt.signature ?? receipt.id;

  return {
    id: `swap-${receipt.mode}-${receipt.network}-${reference}`,
    type: 'swap',
    status: receipt.mode === 'trigger' ? 'settling' : 'settled',
    title: receipt.title,
    subtitle: receipt.subtitle,
    amountLabel: outputLabel ?? inputLabel,
    secondaryAmountLabel: inputLabel,
    rawAmount: primary.rawAmount,
    tokenMint: primary.mint,
    tokenSymbol: primary.symbol,
    tokenName: primary.name,
    tokenLogo: primary.logo,
    tokenDecimals: primary.decimals,
    createdAt: receipt.createdAt,
    signature: receipt.signature,
    sender: receipt.walletAddress ?? null,
    network: receipt.network,
    routeLabel: receipt.mode === 'privacy' ? 'Private swap' : 'Swap',
    privacyLabel: receipt.mode === 'privacy' ? 'Private route' : 'Public route',
    programLabel:
      receipt.mode === 'trigger'
        ? 'Trigger order'
        : receipt.mode === 'recurring'
          ? 'Recurring swap'
          : receipt.mode === 'privacy'
            ? 'Private swap'
            : 'Swap',
  };
}

export function buildLocalHistoryReceiptInputs({
  network,
  walletAddress,
  offlineReceipts = [],
  privatePaymentReceipts = [],
  swapReceipts = [],
}: BuildLocalHistoryReceiptInputsParams): OffpayLocalReceiptViewInput[] {
  const offline = offlineReceipts.filter(
    (receipt) => receiptMatchesNetwork(receipt, network) && isOffpayOfflineP2pReceipt(receipt),
  );
  const privatePayments = privatePaymentReceipts
    .filter(
      (receipt) =>
        receiptMatchesNetwork(receipt, network) && privateReceiptMatchesWallet(receipt, walletAddress),
    )
    .map(mapPrivatePaymentReceiptToLocalHistoryInput);
  const swaps = swapReceipts
    .filter(
      (receipt) => receiptMatchesNetwork(receipt, network) && swapReceiptMatchesWallet(receipt, walletAddress),
    )
    .map(mapSwapReceiptToLocalHistoryInput);

  return [...offline, ...privatePayments, ...swaps];
}
