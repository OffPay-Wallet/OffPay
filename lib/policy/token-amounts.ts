function stripLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, '');
}

function normalizeDigit(char: string): string | null {
  const codePoint = char.codePointAt(0);
  if (codePoint == null) return null;

  if (codePoint >= 48 && codePoint <= 57) {
    return char;
  }

  if (codePoint >= 0xff10 && codePoint <= 0xff19) {
    return String(codePoint - 0xff10);
  }

  if (codePoint >= 0x0660 && codePoint <= 0x0669) {
    return String(codePoint - 0x0660);
  }

  if (codePoint >= 0x06f0 && codePoint <= 0x06f9) {
    return String(codePoint - 0x06f0);
  }

  return null;
}

function countDigits(value: string): number {
  let count = 0;
  for (const char of value) {
    if (normalizeDigit(char) != null) count += 1;
  }

  return count;
}

function getDecimalSeparatorIndex(value: string, maxFractionDigits: number): number {
  if (maxFractionDigits <= 0) return -1;

  const dotIndex = value.lastIndexOf('.');
  const arabicDecimalIndex = value.lastIndexOf('٫');
  if (dotIndex >= 0 || arabicDecimalIndex >= 0) {
    return Math.max(dotIndex, arabicDecimalIndex);
  }

  const commaIndexes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === ',') commaIndexes.push(index);
  }

  if (commaIndexes.length !== 1) return -1;

  const commaIndex = commaIndexes[0] ?? -1;
  const digitsBefore = countDigits(value.slice(0, commaIndex));
  const digitsAfter = countDigits(value.slice(commaIndex + 1));

  if (digitsAfter === 3 && digitsBefore > 0) return -1;
  return commaIndex;
}

export function sanitizeDecimalInput(value: string, maxFractionDigits: number): string {
  const fractionLimit = Math.max(0, Math.trunc(maxFractionDigits));
  const trimmedValue = value.trim();
  const decimalSeparatorIndex = getDecimalSeparatorIndex(trimmedValue, fractionLimit);
  let normalized = '';
  let seenDecimal = false;

  for (let index = 0; index < trimmedValue.length; index += 1) {
    const char = trimmedValue[index] ?? '';
    const digit = normalizeDigit(char);

    if (digit != null) {
      normalized += digit;
      continue;
    }

    if (index === decimalSeparatorIndex && !seenDecimal && fractionLimit > 0) {
      seenDecimal = true;
      normalized += normalized.length === 0 ? '0.' : '.';
    }
  }

  if (normalized.length === 0) return '';

  const [wholePartRaw, fractionPartRaw = ''] = normalized.split('.');
  const wholePart = stripLeadingZeros(wholePartRaw) || '0';
  const fractionPart = fractionPartRaw.slice(0, fractionLimit);

  return seenDecimal ? `${wholePart}.${fractionPart}` : wholePart;
}

export function decimalInputToAtomicAmount(
  value: string,
  decimals: number,
): string | null {
  const normalized = sanitizeDecimalInput(value, decimals);
  if (normalized.length === 0) return null;

  const [wholePartRaw, fractionPartRaw = ''] = normalized.split('.');
  const wholePart = stripLeadingZeros(wholePartRaw) || '0';
  const fractionPart = fractionPartRaw.padEnd(decimals, '0').slice(0, decimals);
  const atomic = stripLeadingZeros(`${wholePart}${fractionPart}`);

  return atomic.length > 0 ? atomic : '0';
}

export function formatAtomicAmount(
  rawAmount: string,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const digitsOnly = rawAmount.replace(/[^\d]/g, '');
  const normalized = stripLeadingZeros(digitsOnly) || '0';

  if (decimals <= 0) return normalized;

  const padded = normalized.padStart(decimals + 1, '0');
  const wholePart = stripLeadingZeros(padded.slice(0, -decimals)) || '0';
  const fractionPart = padded.slice(-decimals).replace(/0+$/, '').slice(0, maxFractionDigits);

  return fractionPart.length > 0 ? `${wholePart}.${fractionPart}` : wholePart;
}
