import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import { isPrivyConfigured, MISSING_PRIVY_ENVIRONMENT_MESSAGE } from '@/lib/privy/config';

export const LOCAL_SIGNING_REQUIRED_MESSAGE =
  'This action needs a local signing wallet. Import a recovery phrase or private-key wallet to continue.';
export const PRIVY_SIGNING_NOT_CONFIGURED_MESSAGE = MISSING_PRIVY_ENVIRONMENT_MESSAGE;

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
    // The Privy signer bridge registers asynchronously after app launch/resume.
    // Signing calls wait for that registration; UI capability checks should not
    // surface the transient warm-up as a global blocker.
    return isPrivyConfigured();
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
    if (!isPrivyConfigured()) {
      return PRIVY_SIGNING_NOT_CONFIGURED_MESSAGE;
    }

    return null;
  }

  if (featureLabel === 'This action') return LOCAL_SIGNING_REQUIRED_MESSAGE;
  return `${featureLabel} needs a local signing wallet. Import a recovery phrase or private-key wallet to continue.`;
}

export const getLocalSigningWalletBlocker = getWalletSigningBlocker;
