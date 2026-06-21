import { describe, expect, it } from '@jest/globals';

import {
  canonicalBodyHash,
  deriveDeviceSecretHex,
  hmacSha256Hex,
  requiresAuthentication,
  verifyAppHmac,
} from '../auth';
import type { Bindings } from '../types';

describe('requiresAuthentication', () => {
  it('keeps public wallet dashboard reads unsigned like balance and transactions', () => {
    expect(requiresAuthentication('GET', '/api/wallet/dashboard')).toBe(false);
    expect(requiresAuthentication('GET', '/api/wallet/balance')).toBe(false);
    expect(requiresAuthentication('GET', '/api/wallet/transactions')).toBe(false);
    expect(requiresAuthentication('GET', '/api/wallet/token-transactions')).toBe(false);
  });

  it('still protects private wallet-prefixed mutations by default', () => {
    expect(requiresAuthentication('POST', '/api/wallet/dashboard')).toBe(true);
  });

  it('verifies HMAC-v2 against the canonical request body hash', async () => {
    const env = {
      OFFPAY_BOOTSTRAP_SECRET: 'bootstrap-secret',
    } as Bindings;
    const walletAddress = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';
    const deviceId = 'device-1';
    const timestamp = Date.now();
    const request = new Request('https://worker.test/api/payment/private-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputMint: 'mint-b', inputMint: 'mint-a', amount: '1000' }),
    });
    const bodyHash = await canonicalBodyHash(request.clone());
    const deviceSecret = await deriveDeviceSecretHex(
      env.OFFPAY_BOOTSTRAP_SECRET,
      walletAddress,
      deviceId,
    );
    const appHmac = await hmacSha256Hex(
      deviceSecret,
      `${timestamp}:${walletAddress}:POST:/api/payment/private-send:${bodyHash}`,
    );

    await expect(
      verifyAppHmac(request, env, walletAddress, timestamp, deviceId, appHmac, 'hmac-v2'),
    ).resolves.toBe(true);

    const tamperedRequest = new Request('https://worker.test/api/payment/private-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputMint: 'mint-b', inputMint: 'mint-a', amount: '2000' }),
    });
    await expect(
      verifyAppHmac(tamperedRequest, env, walletAddress, timestamp, deviceId, appHmac, 'hmac-v2'),
    ).resolves.toBe(false);
  });
});
