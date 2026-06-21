import { describe, expect, it } from '@jest/globals';

import { getRateLimitPolicy } from '../ratelimit';

describe('rate limit policies', () => {
  it('keeps generic broadcasts strict while allowing max offline slot setup', () => {
    expect(getRateLimitPolicy('POST', '/api/rpc/broadcast')).toMatchObject({
      limit: 5,
      windowSec: 60,
      scope: 'wallet',
    });

    const offlineSlotBroadcastPolicy = getRateLimitPolicy(
      'POST',
      '/api/rpc/offline-slot-broadcast',
    );
    expect(offlineSlotBroadcastPolicy).toMatchObject({
      windowSec: 60,
      scope: 'wallet',
    });
    expect(offlineSlotBroadcastPolicy.limit).toBeGreaterThanOrEqual(50);
  });
});
