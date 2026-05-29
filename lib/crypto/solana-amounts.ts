const LAMPORTS_PER_SOL = 1_000_000_000n;

export type LamportInput = string | number | bigint | null | undefined;

export function parseLamports(value: LamportInput): bigint | null {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.trunc(value));
  }

  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  return BigInt(normalized);
}

export function formatLamportsAsExactSol(value: LamportInput): string {
  const lamports = parseLamports(value);
  if (lamports == null) return '0';

  const sign = lamports < 0n ? '-' : '';
  const absLamports = lamports < 0n ? -lamports : lamports;
  const whole = absLamports / LAMPORTS_PER_SOL;
  const fraction = absLamports % LAMPORTS_PER_SOL;
  if (fraction === 0n) return `${sign}${whole}`;

  const fractionText = fraction.toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fractionText}`;
}

export function formatLamportsAsExactSolLabel(value: LamportInput): string {
  return `${formatLamportsAsExactSol(value)} SOL`;
}
