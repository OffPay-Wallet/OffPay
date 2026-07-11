import { describe, expect, it } from '@jest/globals';

import { verifyOffpayAiSessionToken } from '../../../../ai-proxy/src/auth/session-token';
import { issueAiSession, __aiSessionInternal } from '../ai-session';

const SECRET = 'shared-session-secret-at-least-32-characters';
const WALLET = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';

describe('API-issued AI session', () => {
  it('is accepted by the AI proxy verifier with the same server secret', async () => {
    const session = await issueAiSession({
      sharedSecret: SECRET,
      walletAddress: WALLET,
      deviceId: 'device-1',
      network: 'mainnet',
      now: 1_000_000,
    });

    expect(session.expiresAt - session.issuedAt).toBe(__aiSessionInternal.AI_SESSION_TTL_MS);
    await expect(
      verifyOffpayAiSessionToken(session.token, { sharedSecret: SECRET, now: 1_001_000 }),
    ).resolves.toEqual({
      ok: true,
      walletAddress: WALLET,
      deviceId: 'device-1',
      network: 'mainnet',
      expiresAt: session.expiresAt,
    });
  });

  it('refuses a weak or missing signing secret', async () => {
    await expect(
      issueAiSession({
        sharedSecret: 'weak',
        walletAddress: WALLET,
        deviceId: 'device-1',
        network: 'mainnet',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' });
  });
});
