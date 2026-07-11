/**
 * Removes transaction payloads from the model-facing half of a local tool
 * outcome. Tool handlers may keep the same payload in their local `draft`, but
 * no serialized transaction may be copied into the next AI proxy request.
 */

const LOCAL_ONLY_TRANSACTION_KEYS = new Set([
  'messagebase64',
  'rawtransaction',
  'rawtransactions',
  'rawtx',
  'serializedtransaction',
  'serializedtransactions',
  'serializedmessage',
  'signedtransaction',
  'signedtransactions',
  'transactionbase64',
  'transactionsbase64',
  'transactionbytes',
  'transactionmessage',
  'txbase64',
  'unsignedtransaction',
  'unsignedtransactions',
  'unsignedmessage',
  'wiretransaction',
]);

const LOCAL_ONLY_PRIVACY_KEYS = new Set([
  'claimedutxoinsertionindices',
  'endinsertionindex',
  'insertionindex',
  'nextscanstartindex',
  'pendingclaimutxoinsertionindices',
  'startinsertionindex',
  'utxoinsertionindices',
]);

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isLocalOnlyTransactionKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (LOCAL_ONLY_TRANSACTION_KEYS.has(normalized)) return true;

  return (
    normalized.includes('transaction') &&
    (normalized.includes('base64') ||
      normalized.startsWith('raw') ||
      normalized.startsWith('signed') ||
      normalized.startsWith('unsigned') ||
      normalized.startsWith('serialized'))
  );
}

function isLocalOnlyPrivacyKey(key: string): boolean {
  return LOCAL_ONLY_PRIVACY_KEYS.has(normalizeKey(key));
}

export function projectAgenticToolResultForModel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(projectAgenticToolResultForModel);
  }

  if (value == null || typeof value !== 'object') return value;

  const projected: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (
      UNSAFE_OBJECT_KEYS.has(key) ||
      isLocalOnlyTransactionKey(key) ||
      isLocalOnlyPrivacyKey(key)
    ) {
      continue;
    }
    projected[key] = projectAgenticToolResultForModel(nestedValue);
  }
  return projected;
}
