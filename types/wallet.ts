/**
 * Wallet types shared across the application.
 */

/** Number of words in a recovery phrase — 12 or 24 */
export type RecoveryWordCount = 12 | 24;

/** Result of wallet generation or restoration */
export interface WalletData {
  /** Base58-encoded Solana public key (the wallet address) */
  publicKey: string;
  /** Space-separated BIP39 mnemonic words */
  mnemonic: string;
  /** HD derivation path used */
  derivationPath: string;
}

/** Result of private key import (no mnemonic) */
export interface PrivateKeyWalletData {
  /** Base58-encoded Solana public key */
  publicKey: string;
}
