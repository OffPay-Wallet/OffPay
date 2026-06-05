import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';

export const LOCAL_SIGNING_REQUIRED_MESSAGE =
  'This action needs a local signing wallet. Privy wallets keep the signing key with Privy, so use an imported recovery phrase or private-key wallet for now.';

export function walletHasLocalSigningMaterial(
  importMethod: WalletImportMethod | null | undefined,
): boolean {
  return (
    importMethod === 'generated' ||
    importMethod === 'mnemonic-import' ||
    importMethod === 'private-key-import'
  );
}

export function getLocalSigningWalletBlocker(
  importMethod: WalletImportMethod | null | undefined,
  featureLabel = 'This action',
): string | null {
  if (walletHasLocalSigningMaterial(importMethod)) return null;
  if (featureLabel === 'This action') return LOCAL_SIGNING_REQUIRED_MESSAGE;
  return `${featureLabel} needs a local signing wallet. Privy wallets keep the signing key with Privy, so use an imported recovery phrase or private-key wallet for now.`;
}
