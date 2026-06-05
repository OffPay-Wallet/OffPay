import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import { hasExternalWalletSigner } from '@/lib/wallet/external-wallet-signing';

export const LOCAL_SIGNING_REQUIRED_MESSAGE =
  'This action needs a local signing wallet. Import a recovery phrase or private-key wallet to continue.';
export const PRIVY_SIGNING_NOT_READY_MESSAGE =
  'Privy wallet signing is still loading. Sign in again or wait a moment and retry.';

export function walletHasLocalSigningMaterial(
  importMethod: WalletImportMethod | null | undefined,
): boolean {
  return (
    importMethod === 'generated' ||
    importMethod === 'mnemonic-import' ||
    importMethod === 'private-key-import'
  );
}

export function walletCanSignWithApp(params: {
  importMethod: WalletImportMethod | null | undefined;
  walletAddress?: string | null;
}): boolean {
  if (walletHasLocalSigningMaterial(params.importMethod)) return true;
  if (params.importMethod === 'privy-embedded') {
    return params.walletAddress == null || hasExternalWalletSigner(params.walletAddress);
  }
  return false;
}

export function getWalletSigningBlocker(
  importMethod: WalletImportMethod | null | undefined,
  featureLabel = 'This action',
  walletAddress?: string | null,
): string | null {
  if (walletCanSignWithApp({ importMethod, walletAddress })) return null;

  if (importMethod === 'privy-embedded') {
    return featureLabel === 'This action'
      ? PRIVY_SIGNING_NOT_READY_MESSAGE
      : `${featureLabel} needs the Privy wallet signer. Sign in again or wait a moment and retry.`;
  }

  if (featureLabel === 'This action') return LOCAL_SIGNING_REQUIRED_MESSAGE;
  return `${featureLabel} needs a local signing wallet. Import a recovery phrase or private-key wallet to continue.`;
}

export const getLocalSigningWalletBlocker = getWalletSigningBlocker;
