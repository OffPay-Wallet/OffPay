import bs58 from 'bs58';

export function isValidSolanaAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.length === 0) return false;

  try {
    const decoded = bs58.decode(trimmed);
    return decoded.length === 32;
  } catch {
    return false;
  }
}
