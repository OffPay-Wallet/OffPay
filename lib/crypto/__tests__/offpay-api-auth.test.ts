import bs58 from 'bs58';

import {
  buildCanonicalMessage,
  buildHmacMessage,
  buildHmacV2Message,
  buildOffpayAuthHeaders,
  buildOffpayHmacAuthHeaders,
  canonicalBodyHash,
  canonicalJsonStringify,
  hmacSha256Hex,
  signOffpayMessage,
  zeroOutBytes,
} from '@/lib/crypto/offpay-api-auth';

describe('offpay-api-auth', () => {
  it('canonicalizes nested objects deterministically', () => {
    const input = {
      z: [1, undefined, { b: 2, a: 1 }],
      a: { y: undefined, b: 2, a: 1 },
    };

    expect(canonicalJsonStringify(input)).toBe('{"a":{"a":1,"b":2},"z":[1,null,{"a":1,"b":2}]}');
    expect(canonicalBodyHash({ b: 1, a: 2 })).toBe(canonicalBodyHash({ a: 2, b: 1 }));
  });

  it('builds deterministic auth headers from the shared signing contract', () => {
    const signingSeed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const timestamp = 1_710_000_000_000;
    const body = { outputMint: 'mint-b', inputMint: 'mint-a', amount: '1000' };
    const bodyHash = canonicalBodyHash(body);
    const canonicalMessage = buildCanonicalMessage({
      walletAddress: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      timestamp,
      method: 'POST',
      pathAndQuery: '/api/swap/quote?network=mainnet',
      bodyHash,
    });
    const hmacMessage = buildHmacMessage({
      timestamp,
      walletAddress: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      method: 'POST',
      pathAndQuery: '/api/swap/quote?network=mainnet',
    });

    const headers = buildOffpayAuthHeaders({
      walletAddress: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      requestSecret: 'secret-123',
      deviceId: 'device-1',
      bootstrapVersion: 7,
      appVersion: '9.9.9',
      network: 'mainnet',
      method: 'POST',
      pathAndQuery: '/api/swap/quote?network=mainnet',
      body,
      timestamp,
      signingSeed,
    });

    expect(headers['X-App-HMAC']).toBe(hmacSha256Hex('secret-123', hmacMessage));
    expect(headers['X-Signature']).toBe(signOffpayMessage(canonicalMessage, signingSeed));
    expect(headers['X-Bootstrap-Version']).toBe('7');
    expect(bs58.decode(headers['X-Signature'] ?? '').length).toBe(64);
  });

  it('builds HMAC-only headers that bind the request body hash', () => {
    const timestamp = 1_710_000_000_000;
    const body = { outputMint: 'mint-b', inputMint: 'mint-a', amount: '1000' };
    const bodyHash = canonicalBodyHash(body);
    const hmacMessage = buildHmacV2Message({
      timestamp,
      walletAddress: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      method: 'POST',
      pathAndQuery: '/api/payment/private-send',
      bodyHash,
    });

    const headers = buildOffpayHmacAuthHeaders({
      walletAddress: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      requestSecret: 'secret-123',
      deviceId: 'device-1',
      bootstrapVersion: 7,
      appVersion: '9.9.9',
      network: 'devnet',
      method: 'POST',
      pathAndQuery: '/api/payment/private-send',
      body,
      timestamp,
    });

    expect(headers['X-App-Auth-Mode']).toBe('hmac-v2');
    expect(headers['X-App-HMAC']).toBe(hmacSha256Hex('secret-123', hmacMessage));
    expect(headers['X-Signature']).toBeUndefined();
  });

  it('zeros sensitive byte arrays in place', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);

    zeroOutBytes(bytes);

    expect(Array.from(bytes)).toEqual([0, 0, 0, 0]);
  });
});
