export type UmbraErrorAction = 'setup' | 'shield' | 'withdraw' | 'balance' | 'claim';

export interface UmbraFriendlyError {
  title: string;
  message: string;
}

function titleForAction(action: UmbraErrorAction): string {
  switch (action) {
    case 'setup':
      return 'Vault setup failed';
    case 'shield':
      return 'Shield failed';
    case 'withdraw':
      return 'Withdraw failed';
    case 'balance':
      return 'Balance refresh failed';
    case 'claim':
      return 'Claim failed';
  }
}

function rawErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function findJsonObjectText(value: string): string | null {
  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  return value.slice(firstBrace, lastBrace + 1);
}

function tryParseJsonObject(value: string): unknown {
  const jsonText = findJsonObjectText(value);
  if (jsonText == null) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function extractCustomCodeFromValue(value: unknown, allowPlainNumber = false): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return allowPlainNumber ? value : null;
  }
  if (typeof value === 'string') {
    const customMatch = value.match(/Custom['"]?\s*[:=]\s*['"]?(\d+)/i);
    if (customMatch?.[1] != null) return Number(customMatch[1]);

    const programErrorMatch = value.match(/custom program error:\s*(0x[0-9a-f]+|\d+)/i);
    if (programErrorMatch?.[1] != null) {
      const raw = programErrorMatch[1];
      return raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number(raw);
    }

    return extractCustomCodeFromValue(tryParseJsonObject(value));
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const code = extractCustomCodeFromValue(entry);
      if (code != null) return code;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const custom = record.Custom ?? record.custom;
    if (custom != null) return extractCustomCodeFromValue(custom, true);
    const instructionError = record.InstructionError ?? record.instructionError;
    if (instructionError != null) return extractCustomCodeFromValue(instructionError);
    const err = record.err ?? record.error;
    if (err != null) return extractCustomCodeFromValue(err);
  }

  return null;
}

function hasPattern(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function getUmbraFriendlyError(
  error: unknown,
  action: UmbraErrorAction,
): UmbraFriendlyError {
  const message = rawErrorText(error);
  const lowerMessage = message.toLowerCase();
  const customCode = extractCustomCodeFromValue(error) ?? extractCustomCodeFromValue(message);

  if (
    hasPattern(message, /Umbra requires a local signing wallet|Privy wallets keep the signing key/i)
  ) {
    return {
      title: 'Umbra unavailable',
      message,
    };
  }

  if (hasPattern(message, /user rejected|rejected by user|user denied|cancelled|canceled/i)) {
    return {
      title: 'Request cancelled',
      message: 'No transaction submitted.',
    };
  }

  if (
    hasPattern(message, /InsufficientFundsForRent|insufficient funds for rent/i) ||
    hasPattern(message, /insufficient lamports|not enough sol/i) ||
    hasPattern(message, /custom\s*(?:program\s*)?error[:\s]+0x1\b/i)
  ) {
    return {
      title: 'Add SOL for fees',
      message: 'Need more SOL for rent and network fees.',
    };
  }

  if (
    hasPattern(message, /INVALID_REQUEST_BODY|missing field `?variant`?/i) ||
    hasPattern(message, /deserialize the JSON body into the target type/i)
  ) {
    return {
      title: titleForAction(action),
      message: 'Claim request format mismatch. Update the API worker and retry.',
    };
  }

  if (
    hasPattern(
      message,
      /fee[_ ]schedule|fee schedule|fee[_ ]vault|protocol fee account|AccountNotInitialized|AccountDidNotDeserialize/i,
    ) ||
    customCode === 3003 ||
    customCode === 3012
  ) {
    return {
      title: 'Vault unavailable',
      message: 'Token/network vault is not enabled.',
    };
  }

  if (hasPattern(message, /insufficient token|insufficient funds/i)) {
    if (action === 'withdraw') {
      return {
        title: 'Not enough shielded balance',
        message: 'Refresh vault or withdraw less.',
      };
    }
    if (action === 'shield') {
      return {
        title: 'Not enough public balance',
        message: 'Refresh wallet or shield less.',
      };
    }
    return {
      title: 'Insufficient balance',
      message: 'Balance is too low for this action.',
    };
  }

  if (customCode === 1) {
    return {
      title: 'Add SOL or refresh balance',
      message: 'Need SOL for temporary accounts.',
    };
  }

  if (
    customCode === 18003 ||
    hasPattern(message, /active for anonymous usage|anonymous usage.*bit must be set/i)
  ) {
    return {
      title: 'Private P2P setup required',
      message: 'Complete Umbra private P2P setup, wait for confirmation, then retry.',
    };
  }

  if (
    hasPattern(message, /not visible on-chain|signature status|signature.*null/i) ||
    hasPattern(message, /blockhash not found|expired|TransactionExpired/i)
  ) {
    return {
      title: 'Transaction not confirmed',
      message: 'Refresh vault and retry if unchanged.',
    };
  }

  if (hasPattern(message, /did not submit a transaction|signature.*missing|no signature/i)) {
    return {
      title: 'No transaction submitted',
      message: 'Unlock wallet and try again.',
    };
  }

  if (
    hasPattern(message, /vault setup.*not confirmed|encrypted-balance account is not confirmed/i) ||
    hasPattern(message, /vault.*not.*ready|balance_not_initialised|uninitialized/i)
  ) {
    return {
      title: 'Vault not ready',
      message: 'Refresh after setup or shield settles.',
    };
  }

  if (
    hasPattern(message, /settlement is still pending/i) ||
    hasPattern(message, /callback.*(?:timed-out|pruned)/i)
  ) {
    return {
      title: 'Settlement pending',
      message: 'Refresh shielded balance in a moment.',
    };
  }

  if (
    lowerMessage.includes('network request failed') ||
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('offline')
  ) {
    return {
      title: 'Network unavailable',
      message: 'Check connection and try again.',
    };
  }

  // Transient relayer / Solana-RPC failures that the upstream Umbra
  // relayer reports verbatim through `failureReason`. The on-chain
  // tx never landed (or was rejected by the RPC); the user should be
  // prompted to retry rather than shown the raw stack.
  if (
    hasPattern(message, /tx_pipeline|tx pipeline|relayer.*(unavailable|error|failed)/i) ||
    hasPattern(message, /rpc error.*sendtransaction|sendtransaction.*(rpc|error)/i) ||
    hasPattern(message, /UPSTREAM_UNAVAILABLE|upstream unavailable|503|502|504/i) ||
    hasPattern(message, /node is behind|connection refused|gateway timeout/i)
  ) {
    return {
      title: action === 'claim' ? 'Claim retry needed' : titleForAction(action),
      message: 'Relayer is temporarily unavailable. Tap retry in a moment.',
    };
  }

  if (
    hasPattern(message, /simulation failed|transaction failed|InstructionError/i) ||
    customCode != null
  ) {
    return {
      title: titleForAction(action),
      message: 'Rejected on-chain. Refresh and retry.',
    };
  }

  return {
    title: titleForAction(action),
    message,
  };
}

export function getUmbraFriendlyErrorMessage(error: unknown, action: UmbraErrorAction): string {
  return getUmbraFriendlyError(error, action).message;
}

/**
 * Returns true when the error came from the Umbra relayer's transaction
 * pipeline / Solana RPC step. These are transient — the on-chain tx
 * never landed, no nullifier was inserted, and a bare retry is safe.
 */
export function isTransientRelayerFailure(error: unknown): boolean {
  const message = rawErrorText(error);
  if (message.length === 0) return false;

  if (
    /tx_pipeline|tx pipeline|relayer.*(unavailable|error|failed)/i.test(message) ||
    /rpc error.*sendtransaction|sendtransaction.*(rpc|error)/i.test(message) ||
    /UPSTREAM_UNAVAILABLE|upstream unavailable/i.test(message) ||
    /node is behind|connection refused|gateway timeout/i.test(message) ||
    /\b(502|503|504)\b/.test(message)
  ) {
    return true;
  }

  const lower = message.toLowerCase();
  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused')
  ) {
    return true;
  }

  return false;
}
